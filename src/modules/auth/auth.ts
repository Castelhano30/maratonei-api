import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
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
const RESET_TOKEN_SECONDS = 60 * 60;
const RESET_PASSWORD_PATH = '/redefinir-senha';
/** Janela em que a sessão conta como "fresca" para ações sensíveis (excluir a conta). */
export const SESSION_FRESH_SECONDS = 5 * 60;
export const NAME_MAX_LENGTH = 80;
const CREDENTIAL_PROVIDER_ID = 'credential';

/** Opções do provedor Google aceitas pelo Better Auth (usadas só para fakes nos testes). */
export type GoogleProviderOptions = NonNullable<
  NonNullable<BetterAuthOptions['socialProviders']>['google']
>;

export interface AuthOptions {
  config?: Pick<
    Config,
    | 'NODE_ENV'
    | 'WEB_ORIGIN'
    | 'ALLOWED_ORIGINS'
    | 'BETTER_AUTH_SECRET'
    | 'GOOGLE_CLIENT_ID'
    | 'GOOGLE_CLIENT_SECRET'
  >;
  email?: EmailSender;
  /** Rate limit do Better Auth nas rotas de auth (ligado por padrão, exceto em NODE_ENV=test). */
  rateLimit?: boolean;
  /**
   * Só para testes: sobrescreve partes do provedor Google (`getUserInfo`, `verifyIdToken`) para
   * nunca chamar o Google de verdade. Habilita o login por ID token, que fora disso fica desligado.
   */
  googleOverrides?: Partial<GoogleProviderOptions>;
}

/**
 * Única instância do Better Auth (AD-6): nada fora de `modules/auth` importa o pacote.
 * Cadastro com senha abre a sessão na hora, sem verificação de e-mail (desligada por ora; a coluna
 * `emailVerified` segue gravada como `false` para a verificação voltar sem migração).
 */
export function createAuth(options: AuthOptions = {}) {
  const config = options.config ?? defaultConfig;
  const email = options.email ?? emailSender;
  const secure = config.NODE_ENV === 'production';
  const googleEnabled = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);

  return betterAuth({
    baseURL: config.WEB_ORIGIN,
    basePath: AUTH_BASE_PATH,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: config.ALLOWED_ORIGINS,
    // Falhas do OAuth voltam ao web (`/entrar?error=...`), nunca à página de erro do Better Auth.
    onAPIError: { errorURL: new URL('/entrar', config.WEB_ORIGIN).toString() },
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      requireEmailVerification: false,
      autoSignIn: true,
      password: { hash: hashPassword, verify: verifyPassword },
      resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // O envio nunca muda a resposta HTTP: throttle e teto do `lib/email` descartam em silêncio.
        await email.send({
          to: user.email,
          subject: 'Redefina sua senha no Maratonei',
          text: `Olá, ${user.name}!\n\nPara criar uma senha nova, abra o link (ele vale por 1 hora e só funciona uma vez):\n${withWebCallback(url, config.WEB_ORIGIN, RESET_PASSWORD_PATH)}\n\nSe não foi você, pode ignorar este e-mail.\n`,
        });
      },
    },
    // Google só é ligado com credenciais. Vínculo por e-mail apenas se o e-mail do Google vier
    // verificado (o provedor não é "confiável" por nome); a conta local não verificada é limpa
    // no hook `account.create.after` abaixo.
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: config.GOOGLE_CLIENT_ID!,
            clientSecret: config.GOOGLE_CLIENT_SECRET!,
            disableIdTokenSignIn: !options.googleOverrides,
            ...options.googleOverrides,
          },
        }
      : {},
    account: {
      accountLinking: { enabled: true, requireLocalEmailVerified: false },
    },
    user: { deleteUser: { enabled: true } },
    databaseHooks: {
      user: {
        create: {
          // E-mail não verificado só nasce por cadastro com senha. Fora disso (Google sem
          // e-mail verificado) nada é criado: evita conta pendurada para pré-sequestro.
          before: (data, context) => {
            const path = context?.path ?? '';
            if (!(data.emailVerified === true || path.startsWith('/sign-up'))) {
              return Promise.resolve(false);
            }
            const name = typeof data.name === 'string' ? data.name.trim() : '';
            if (path.startsWith('/sign-up')) {
              if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
                throw new APIError('BAD_REQUEST', {
                  code: 'INVALID_NAME',
                  message: `O nome deve ter de 1 a ${NAME_MAX_LENGTH} caracteres.`,
                });
              }
              return Promise.resolve({ data: { ...data, name } });
            }
            // Google: o nome vem do provedor; apara em vez de recusar o login.
            return Promise.resolve({
              data: { ...data, name: name.slice(0, NAME_MAX_LENGTH) || 'Usuário' },
            });
          },
        },
        update: {
          // Promoção a verificado pelo OAuth: nada anterior à prova do e-mail sobrevive.
          after: async (user, context) => {
            const path = context?.path ?? '';
            if (user?.emailVerified !== true) return;
            if (!path.startsWith('/callback') && !path.startsWith('/sign-in/social')) return;
            await revokeUnprovenAccess(user.id);
          },
          // `updateUser` aceita só nome (1–80 após trim) e imagem (URL https ou null).
          before: (data) => {
            const changes: Record<string, unknown> = {};
            if (data.name !== undefined) {
              const name = typeof data.name === 'string' ? data.name.trim() : '';
              if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
                throw new APIError('BAD_REQUEST', {
                  code: 'INVALID_NAME',
                  message: `O nome deve ter de 1 a ${NAME_MAX_LENGTH} caracteres.`,
                });
              }
              changes.name = name;
            }
            if (data.image !== undefined && data.image !== null && !isHttpsUrl(data.image)) {
              throw new APIError('BAD_REQUEST', {
                code: 'INVALID_IMAGE',
                message: 'A imagem deve ser uma URL https ou nula.',
              });
            }
            return Promise.resolve({ data: changes });
          },
        },
      },
      account: {
        create: {
          // Vínculo Google numa conta local não verificada: ninguém provou ser dono daquele
          // e-mail, então a senha e as sessões que ela acumulou deixam de valer.
          after: async (account) => {
            if (!account || account.providerId === CREDENTIAL_PROVIDER_ID) return;
            const user = await prisma.user.findUnique({ where: { id: account.userId } });
            if (!user || user.emailVerified) return;
            await revokeUnprovenAccess(user.id);
          },
        },
      },
    },
    session: {
      expiresIn: 30 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      freshAge: SESSION_FRESH_SECONDS,
    },
    rateLimit: { enabled: options.rateLimit ?? config.NODE_ENV !== 'test', storage: 'memory' },
    advanced: {
      // Explícito para os testes (NODE_ENV=test) exercitarem a mesma validação de callbackURL da produção.
      disableOriginCheck: false,
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure },
      database: { generateId: () => uuidv7() },
    },
  });
}

/**
 * O link de reset passa pela API e redirecionam ao web. O Better Auth usa
 * `callbackURL=/` (ou vazio) por padrão, relativo, que resolveria na origem da API: aqui o
 * destino vira sempre absoluto na origem do web, ou `defaultPath` quando não há destino.
 */
function withWebCallback(url: string, webOrigin: string, defaultPath: string): string {
  const link = new URL(url);
  const callback = link.searchParams.get('callbackURL');
  const target = !callback || callback === '/' ? defaultPath : callback;
  const resolved = new URL(target, webOrigin);
  // `callbackURL` absoluto de outra origem confiável (ex.: a da API) nunca vira destino do link.
  const safe = resolved.origin === webOrigin ? resolved : new URL(defaultPath, webOrigin);
  link.searchParams.set('callbackURL', safe.toString());
  return link.toString();
}

/** Apaga a senha e as sessões de uma conta cujo e-mail nunca foi provado. */
export async function revokeUnprovenAccess(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.account.deleteMany({ where: { userId, providerId: CREDENTIAL_PROVIDER_ID } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export type Auth = ReturnType<typeof createAuth>;

export const auth: Auth = createAuth();

/** Handler Node do Better Auth: `app.ts` monta só isto, sem importar o pacote (AD-6). */
export function createAuthHandler(instance: Auth = auth) {
  return toNodeHandler(instance);
}
