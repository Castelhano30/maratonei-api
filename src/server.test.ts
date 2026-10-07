import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// No Windows, SIGTERM/SIGINT encerram o processo à força (sem handler); o
// shutdown gracioso é verificado no CI (Linux).
describe.skipIf(process.platform === 'win32')('server.ts', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)(
    'sobe, responde e encerra com código 0 ao receber %s',
    async (signal) => {
      const require = createRequire(import.meta.url);
      const tsx = pathToFileURL(require.resolve('tsx')).href;
      const port = String(41000 + Math.floor(Math.random() * 1000));
      const child = spawn(process.execPath, ['--import', tsx, 'src/server.ts'], {
        env: { ...process.env, PORT: port, LOG_LEVEL: 'info' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

      const deadline = Date.now() + 20_000;
      while (!output.includes('ouvindo')) {
        if (Date.now() > deadline || child.exitCode !== null) throw new Error(output);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      expect(res.status).toBe(200);

      child.kill(signal);
      const [code] = await once(child, 'exit');
      expect(code).toBe(0);
      expect(output).toContain('encerrado');
    },
    30_000,
  );
});
