/**
 * ResponseRegistry — correlate command responses by ID.
 *
 * Standalone class managing a Map of pending promises keyed by command ID (bigint).
 * User wires it as an interceptor on the binary message path.
 *
 * ## Usage
 *
 * ```ts
 * const registry = new ResponseRegistry(
 *   (data) => {
 *     const msg = ResponseMessage.getRootAsResponseMessage(new ByteBuffer(new Uint8Array(data)));
 *     return msg.id();
 *   },
 *   5000, // timeout
 * );
 *
 * pipeline.onBinaryMessage((data) => {
 *   if (!registry.handleMessage(data)) {
 *     parser.ingestFrame(data);  // not a response → normal frame
 *   }
 * });
 * pipeline.onDisconnect(() => registry.rejectAll('Connection lost'));
 * ```
 */
export class ResponseRegistry<R = ArrayBuffer> {
  private pending: Map<bigint, {
    resolve: (data: R) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  private extractId: (data: ArrayBuffer) => bigint | null;
  private deserialize: (data: ArrayBuffer) => R;
  private timeoutMs: number;

  constructor(
    extractId: (data: ArrayBuffer) => bigint | null,
    timeoutMs = 5000,
    deserialize?: (data: ArrayBuffer) => R,
  ) {
    this.extractId = extractId;
    this.timeoutMs = timeoutMs;
    // Safe cast: when R = ArrayBuffer (default), data is already R
    this.deserialize = deserialize ?? ((data: ArrayBuffer) => data as unknown as R);
  }

  /** Register a pending response for the given command ID. Returns a promise that resolves with the deserialized response. */
  register(id: bigint): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Response timeout for command ${id}`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
    });
  }

  /** Try to match an incoming message as a response. Returns true if consumed. */
  handleMessage(data: ArrayBuffer): boolean {
    const id = this.extractId(data);
    if (id === null) return false;

    const entry = this.pending.get(id);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(this.deserialize(data));
    return true;
  }

  /** Reject all pending responses (e.g. on disconnect). */
  rejectAll(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  /** Number of pending responses. */
  get pendingCount(): number {
    return this.pending.size;
  }
}
