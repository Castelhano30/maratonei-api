import type { Express } from 'express';
import { createApp } from '../../src/app.js';

let app: Express | undefined;

/** Instância compartilhada da aplicação real para os testes. */
export function testApp(): Express {
  app ??= createApp();
  return app;
}
