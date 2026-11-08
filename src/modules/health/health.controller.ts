import type { RequestHandler } from 'express';
import { config } from '../../config.js';
import { getLiveness, getReadiness } from './health.service.js';

export const getHealth: RequestHandler = (req, res) => {
  if (config.LOG_CLIENT_IP_DEBUG) {
    req.log.info(
      { ip: req.ip, ips: req.ips, xForwardedFor: req.headers['x-forwarded-for'] },
      'client-ip-debug',
    );
  }
  res.json(getLiveness());
};

export const getHealthReady: RequestHandler = async (_req, res) => {
  res.json(await getReadiness());
};
