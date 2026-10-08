import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { AppError } from '../../http/app-error.js';
import { auth as defaultAuth, type Auth } from './auth.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Preenchido por `requireSession`. */
      user?: SessionUser;
    }
  }
}

/**
 * Exige sessão válida (cookie) e popula `req.user = {id, email, name}`.
 * Sem sessão ou expirada: 401 `UNAUTHENTICATED`.
 */
export function requireSession(auth: Auth = defaultAuth): RequestHandler {
  return async (req, _res, next) => {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) {
        next(new AppError('UNAUTHENTICATED'));
        return;
      }
      const { id, email, name } = session.user;
      req.user = { id, email, name };
      next();
    } catch (error) {
      next(error);
    }
  };
}
