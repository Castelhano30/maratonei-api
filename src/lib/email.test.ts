import { describe, expect, it } from 'vitest';
import { createEmailSender, type EmailMessage } from './email.js';

const message = (to: string): EmailMessage => ({ to, subject: 'Assunto', text: 'Corpo' });

function setup(options: { throttleMs?: number; dailyLimit?: number } = {}) {
  const sent: EmailMessage[] = [];
  let clock = Date.UTC(2026, 9, 8, 12);
  const sender = createEmailSender({
    transport: (m) => {
      sent.push(m);
    },
    now: () => clock,
    ...options,
  });
  return {
    sender,
    sent,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('createEmailSender', () => {
  it('envia o primeiro e-mail e descarta o repetido dentro da janela do destinatário', async () => {
    const { sender, sent, advance } = setup({ throttleMs: 60_000 });

    expect(await sender.send(message('a@x.test'))).toBe('sent');
    expect(await sender.send(message('A@x.test'))).toBe('throttled');
    expect(await sender.send(message('b@x.test'))).toBe('sent');
    advance(60_000);
    expect(await sender.send(message('a@x.test'))).toBe('sent');
    expect(sent).toHaveLength(3);
  });

  it('respeita o teto diário e zera no dia seguinte', async () => {
    const { sender, sent, advance } = setup({ throttleMs: 0, dailyLimit: 2 });

    expect(await sender.send(message('a@x.test'))).toBe('sent');
    expect(await sender.send(message('b@x.test'))).toBe('sent');
    expect(await sender.send(message('c@x.test'))).toBe('daily-limit');
    advance(24 * 60 * 60 * 1000);
    expect(await sender.send(message('c@x.test'))).toBe('sent');
    expect(sent).toHaveLength(3);
  });

  it('e-mail descartado por throttle não consome o teto diário', async () => {
    const { sender, advance } = setup({ throttleMs: 1000, dailyLimit: 2 });

    await sender.send(message('a@x.test'));
    await sender.send(message('a@x.test'));
    advance(1000);
    expect(await sender.send(message('b@x.test'))).toBe('sent');
  });
});
