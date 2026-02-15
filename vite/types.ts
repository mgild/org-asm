export interface OrgAsmViteOptions {
  server?: {
    /** Cargo crate name (default: 'server') */
    crate: string;
    /** Server port (default: 9001) */
    port?: number;
    /** Extra environment variables for the server process */
    env?: Record<string, string>;
  };
}
