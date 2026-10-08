import { config, type Config } from '../config.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type EmailTransport = (message: EmailMessage) => Promise<void> | void;

export type EmailOutcome = 'sent' | 'throttled' | 'daily-limit';

export interface EmailSenderOptions {
  transport: EmailTransport;
  /** Intervalo mínimo entre e-mails para o mesmo destinatário. */
  throttleMs?: number;
  /** Teto de e-mails por dia (UTC) somando todos os destinatários. */
  dailyLimit?: number;
  now?: () => number;
}

export const DEFAULT_EMAIL_THROTTLE_MS = 60_000;
export const DEFAULT_EMAIL_DAILY_LIMIT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Envio de e-mail com throttle por destinatário e teto diário. Excedido o limite,
 * o e-mail é descartado em silêncio (`send` devolve o motivo): quem chama não muda
 * a resposta HTTP, então o limite não vira canal de enumeração de contas.
 */
export function createEmailSender(options: EmailSenderOptions) {
  let transport = options.transport;
  let throttleMs = options.throttleMs ?? DEFAULT_EMAIL_THROTTLE_MS;
  let dailyLimit = options.dailyLimit ?? DEFAULT_EMAIL_DAILY_LIMIT;
  const now = options.now ?? Date.now;
  const lastSentAt = new Map<string, number>();
  let day = Math.floor(now() / DAY_MS);
  let sentToday = 0;

  return {
    async send(message: EmailMessage): Promise<EmailOutcome> {
      const current = now();
      const today = Math.floor(current / DAY_MS);
      if (today !== day) {
        day = today;
        sentToday = 0;
      }
      if (sentToday >= dailyLimit) return 'daily-limit';

      const key = message.to.toLowerCase();
      const last = lastSentAt.get(key);
      if (last !== undefined && current - last < throttleMs) return 'throttled';

      // Reserva antes do await: duas chamadas concorrentes não furam o limite.
      lastSentAt.set(key, current);
      sentToday += 1;
      if (lastSentAt.size > 10_000) {
        for (const [recipient, at] of lastSentAt) {
          if (current - at >= throttleMs) lastSentAt.delete(recipient);
        }
      }
      await transport(message);
      return 'sent';
    },
    /** Troca o transporte e os limites (usado pelos testes). */
    configure(next: Partial<Pick<EmailSenderOptions, 'transport' | 'throttleMs' | 'dailyLimit'>>) {
      if (next.transport) transport = next.transport;
      if (next.throttleMs !== undefined) throttleMs = next.throttleMs;
      if (next.dailyLimit !== undefined) dailyLimit = next.dailyLimit;
    },
    /** Zera os contadores (usado pelos testes). */
    reset() {
      lastSentAt.clear();
      sentToday = 0;
    },
  };
}

export type EmailSender = ReturnType<typeof createEmailSender>;

/** Transporte de desenvolvimento: escreve o e-mail no stdout. */
export const consoleTransport: EmailTransport = (message) => {
  process.stdout.write(
    `\n[email] para: ${message.to}\n[email] assunto: ${message.subject}\n${message.text}\n\n`,
  );
};

export function transportFor(name: Config['EMAIL_TRANSPORT']): EmailTransport {
  switch (name) {
    case 'console':
      return consoleTransport;
  }
}

/** Remetente único da API, com o transporte escolhido em `EMAIL_TRANSPORT`. */
export const emailSender: EmailSender = createEmailSender({
  transport: transportFor(config.EMAIL_TRANSPORT),
});
