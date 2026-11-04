import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuid7.js';

describe('uuidv7', () => {
  it('tem versão 7, variante RFC 9562 e embute o timestamp em ms', () => {
    const now = Date.UTC(2026, 9, 8, 12, 0, 0);
    const id = uuidv7(now);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(now);
  });

  it('ordena por tempo e não repete', () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);

    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 100 }, () => uuidv7(1_000))).size).toBe(100);
  });
});
