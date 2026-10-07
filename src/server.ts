import 'dotenv/config';
import { createApp } from './app.js';
import { config } from './config.js';
import { createLogger } from './http/logger.js';
import { prisma } from './lib/prisma.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const logger = createLogger(config);
const app = createApp({ config, logger });

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'maratonei-api ouvindo');
});

server.on('error', (error) => {
  logger.fatal({ err: error }, 'falha ao abrir o servidor HTTP');
  process.exit(1);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'encerrando');

  const force = setTimeout(() => {
    logger.error('encerramento passou do limite; saindo à força');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    });
    await prisma.$disconnect();
    logger.info('encerrado');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'erro ao encerrar');
    process.exit(1);
  }
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));
