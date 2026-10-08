import argon2 from 'argon2';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Hash argon2id (parâmetros padrão do pacote). */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/** Compara a senha com o hash; hash malformado conta como senha errada. */
export async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  try {
    return await argon2.verify(data.hash, data.password);
  } catch {
    return false;
  }
}
