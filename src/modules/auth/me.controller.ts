import type { RequestHandler } from 'express';
import { AppError } from '../../http/app-error.js';
import { getMe as findMe } from './me.service.js';

export const getMe: RequestHandler = async (req, res) => {
  if (!req.user) throw new AppError('UNAUTHENTICATED');
  res.json(await findMe(req.user.id));
};
