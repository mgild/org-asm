import { spawn, type ChildProcess } from 'child_process';
import type { Plugin } from 'vite';

export function rustServerPlugin(opts: {
  crate: string;
  env?: Record<string, string>;
}): Plugin {
  let proc: ChildProcess | null = null;

  const crateName = opts.crate;
  const rustLogName = crateName.replace(/-/g, '_');
  const env = {
    ...process.env,
    RUST_LOG: `${rustLogName}=info`,
    ...opts.env,
  };

  function kill() {
    if (proc) {
      proc.kill('SIGTERM');
      proc = null;
    }
  }

  return {
    name: 'org-asm:rust-server',
    apply: 'serve',
    configureServer() {
      proc = spawn('cargo', ['run', '-p', crateName], {
        stdio: 'inherit',
        env,
      });
      proc.on('error', (err) =>
        console.error(`[org-asm:rust-server] spawn error: ${err.message}`),
      );
      proc.on('exit', (code) => {
        if (code !== null && code !== 0) {
          console.error(`[org-asm:rust-server] exited with code ${code}`);
        }
        proc = null;
      });

      const onSignal = () => {
        kill();
        process.exit();
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
    },
    buildEnd() {
      kill();
    },
  };
}
