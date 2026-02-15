import type { Plugin } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { rustServerPlugin } from './rustServerPlugin.js';
import type { OrgAsmViteOptions } from './types.js';

export type { OrgAsmViteOptions } from './types.js';

/**
 * org-asm Vite plugin.
 *
 * Returns an array of Vite plugins that:
 * 1. Spawn the Rust server as a child process (dev mode only)
 * 2. Configure proxy for /ws and /api
 * 3. Enable WASM imports + top-level await
 */
export function orgAsm(options: OrgAsmViteOptions = {}): Plugin[] {
  const crate = options.server?.crate ?? 'server';
  const port = options.server?.port ?? 9001;

  const proxyPlugin: Plugin = {
    name: 'org-asm:proxy',
    config() {
      return {
        server: {
          proxy: {
            '/ws': { target: `ws://localhost:${port}`, ws: true },
            '/api': { target: `http://localhost:${port}` },
          },
        },
        build: {
          target: 'esnext',
        },
      };
    },
  };

  return [
    rustServerPlugin({ crate, env: options.server?.env }),
    proxyPlugin,
    wasm(),
    topLevelAwait(),
  ];
}
