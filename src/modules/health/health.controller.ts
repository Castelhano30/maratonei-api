import type { RequestHandler } from 'express';
import { getLiveness, getReadiness } from './health.service.js';

export const getHealth: RequestHandler = (_req, res) => {
  res.json(getLiveness());
};

export const getHealthReady: RequestHandler = async (_req, res) => {
  res.json(await getReadiness());
};
