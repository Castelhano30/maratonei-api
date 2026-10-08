import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { config as defaultConfig, type Config } from '../../config.js';
import { prisma } from '../../lib/prisma.js';
import { emailSender, type EmailSender } from '../../lib/email.js';
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from './password.js';
import { uuidv7 } from './uuid7.js';

export const AUTH_BASE_PATH = '/api/v1/auth';
/** Nome do cookie fora de produção; em produção o Better Auth acrescenta o prefixo `__Secure-`. */
export const SESSION_COOKIE_NAME = 'better-auth.session_token';

const DAY_SECONDS = 24 * 60 * 60;

export interface AuthOptions {
  config?: Pick<Config, 'NODE_ENV' | 'WEB_ORIGIN' | 'ALLOWED_ORIGINS' | 'BETTER_AUTH_SECRET'>;
  email?: EmailSender;
  /** Rate limit do Better Auth nas rotas de auth (ligado por padrão, exceto em NODE_ENV=test). */
  rateLimit?: boolean;
}

/**
 * Única instância do Better Auth (AD-6): nada fora de `modules/auth` importa o pacote.
 * Verificação de e-mail obrigatória, sem login automático em nenhum ponto.
 */
export function createAuth(options: AuthOptions = {}) {
  const config = options.config ?? defaultConfig;
  const email = options.email ?? emailSender;
  const secure = config.NODE_ENV === 'production';

  return betterAuth({
    baseURL: config.WEB_ORIGIN,
    basePath: AUTH_BASE_PATH,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: config.ALLOWED_ORIGINS,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      requireEmailVerification: true,
      autoSignIn: false,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: DAY_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        await email.send({
          to: user.email,
          subject: 'Confirme seu e-mail no Maratonei',
          text: `Olá, ${user.name}!\n\nConfirme seu e-mail (o link vale por 24 horas):\n${withWebCallback(url, config.WEB_ORIGIN)}\n`,
        });
      },
    },
    session: { expiresIn: 30 * DAY_SECONDS, updateAge: DAY_SECONDS },
    rateLimit: { enabled: options.rateLimit ?? config.NODE_ENV !== 'test', storage: 'memory' },
    advanced: {
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure },
      database: { generateId: () => uuidv7() },
    },
  });
}

/**
 * O link de verificação passa pela API e redireciona ao web. O Better Auth usa
 * `callbackURL=/` por padrão (relativo, que resolveria na origem da API): aqui o
 * destino vira sempre absoluto na origem do web, ou a tela de verificação do web quando é só `/`.
 */
function withWebCallback(url: string, webOrigin: string): string {
  const link = new URL(url);
  const callback = link.searchParams.get('callbackURL');
  const target = !callback || callback === '/' ? '/verificar-email?verified=1' : callback;
  const resolved = new URL(target, webOrigin);
  // `callbackURL` absoluto de outra origem confiável (ex.: a da API) nunca vira destino do link.
  const safe =
    resolved.origin === webOrigin ? resolved : new URL('/verificar-email?verified=1', webOrigin);
  link.searchParams.set('callbackURL', safe.toString());
  return link.toString();
}

export type Auth = ReturnType<typeof createAuth>;

export const auth: Auth = createAuth();

/** Handler Node do Better Auth: `app.ts` monta só isto, sem importar o pacote (AD-6). */
export function createAuthHandler(instance: Auth = auth) {
  return toNodeHandler(instance);
}
