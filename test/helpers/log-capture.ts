import type { Logger } from 'pino';
import { createLogger } from '../../src/http/logger.js';

export interface LogLine {
  level: number;
  msg?: string;
  requestId?: string;
  [key: string]: unknown;
}

/** Logger real (mesmo redact da aplicação) que grava as linhas em memória. */
export function captureLogs(): { logger: Logger; lines: LogLine[]; raw: string[] } {
  const raw: string[] = [];
  const lines: LogLine[] = [];
  const logger = createLogger(
    { LOG_LEVEL: 'info' },
    {
      write(chunk: string) {
        raw.push(chunk);
        lines.push(JSON.parse(chunk) as LogLine);
      },
    },
  );
  return { logger, lines, raw };
}
