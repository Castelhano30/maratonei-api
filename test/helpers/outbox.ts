import { emailSender, type EmailMessage } from '../../src/lib/email.js';

/** E-mails "enviados" durante o teste corrente (o transporte real não é usado). */
export const outbox: EmailMessage[] = [];

/** Troca o transporte por uma captura em memória e zera throttle e contadores. */
export function resetOutbox(): void {
  outbox.length = 0;
  emailSender.configure({
    transport: (message) => {
      outbox.push(message);
    },
    throttleMs: 0,
    dailyLimit: Number.MAX_SAFE_INTEGER,
  });
  emailSender.reset();
}

/** Primeiro link http(s) do corpo do e-mail. */
export function linkIn(message: EmailMessage): string {
  const match = /https?:\/\/\S+/.exec(message.text);
  if (!match) throw new Error('O e-mail não contém link.');
  return match[0];
}
