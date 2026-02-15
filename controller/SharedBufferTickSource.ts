/**
 * SharedBufferTickSource — Tick source factories that read frames from a
 * SharedArrayBuffer written by a Worker thread.
 *
 * These plug directly into AnimationLoop's structural { tick(nowMs): F }
 * interface. The Worker writes frame data into the SAB on its own timer
 * (setInterval ~60fps), and the main thread reads the latest frame on
 * each requestAnimationFrame tick — zero postMessage overhead per frame.
 *
 * SharedArrayBuffer layout (header):
 *   Bytes 0-7:   sequence number (Float64) — incremented each worker tick
 *   Bytes 8-15:  timestamp (Float64) — worker's Date.now() at write time
 *   Bytes 16-19: frame length in bytes (Uint32) — for FlatBuffer mode only
 *   Bytes 20+:   frame data
 *
 * Usage (Float64Array mode):
 *   const source = sharedBufferTickSource(buffer, frameSize);
 *   const loop = new AnimationLoop(source);
 *
 * Usage (FlatBuffer mode):
 *   const source = sharedBufferFlatBufferTickSource(buffer, maxBytes, rootFn);
 *   const loop = new AnimationLoop(source);
 */

/** Byte offsets for the SAB header */
const SEQUENCE_OFFSET = 0;       // Float64 at byte 0
const TIMESTAMP_OFFSET = 1;      // Float64 at byte 8
const FRAME_LENGTH_OFFSET = 16;  // Uint32 at byte 16
const HEADER_BYTES = 20;         // Frame data starts at byte 20
const HEADER_FLOAT64S = HEADER_BYTES / 8; // 2.5 → rounds to 3 for Float64 alignment

/**
 * Create a tick source that reads Float64Array frames from a SharedArrayBuffer.
 *
 * Returns a subarray view into the SAB — zero-copy on the main thread.
 * The Worker must write Float64 values starting at byte offset 20 (after
 * the 20-byte header).
 *
 * @param buffer - SharedArrayBuffer shared with the Worker
 * @param frameSize - Number of Float64 elements in the frame
 */
export function sharedBufferTickSource(
  buffer: SharedArrayBuffer,
  frameSize: number,
): { tick(nowMs: number): Float64Array } {
  // View spanning header + frame data
  // Frame data starts at Float64 index 3 (byte 24, padded from byte 20 for alignment)
  const FRAME_START = 3; // ceil(20 / 8) = 3 Float64s for header
  const view = new Float64Array(buffer, 0, FRAME_START + frameSize);

  return {
    tick(_nowMs: number): Float64Array {
      return view.subarray(FRAME_START, FRAME_START + frameSize);
    },
  };
}

/**
 * Create a tick source that reads FlatBuffer frames from a SharedArrayBuffer.
 *
 * Reads the frame length from the header (bytes 16-19), copies that many
 * bytes from the data region, and deserializes via the provided rootFn.
 *
 * The copy is necessary because FlatBuffer deserialization needs a stable
 * byte array, and the SAB data region may be overwritten at any time by
 * the Worker. The copy is small (~300 bytes at 60fps) and fast.
 *
 * @param buffer - SharedArrayBuffer shared with the Worker
 * @param maxBytes - Maximum frame size in bytes (determines SAB allocation)
 * @param rootFn - FlatBuffer root deserialization function
 */
export function sharedBufferFlatBufferTickSource<F>(
  buffer: SharedArrayBuffer,
  maxBytes: number,
  rootFn: (bytes: Uint8Array) => F,
): { tick(nowMs: number): F } {
  const lengthView = new Uint32Array(buffer, FRAME_LENGTH_OFFSET, 1);
  const dataView = new Uint8Array(buffer, HEADER_BYTES, maxBytes);
  const copyBuf = new Uint8Array(maxBytes);

  return {
    tick(_nowMs: number): F {
      const len = Atomics.load(lengthView, 0);
      // Copy from SAB to local buffer for stable deserialization
      copyBuf.set(dataView.subarray(0, len));
      return rootFn(copyBuf.subarray(0, len));
    },
  };
}

/**
 * Wraps a tick source to track whether a new frame has been written since
 * the last read. Reads the sequence number from the SAB header.
 *
 * Usage:
 *   const tracked = withSequenceTracking(source, buffer);
 *   // In animation loop:
 *   const frame = tracked.tick(now);
 *   if (tracked.newFrame) {
 *     // Worker produced a new frame since last tick
 *   }
 */
export function withSequenceTracking<F>(
  source: { tick(nowMs: number): F },
  buffer: SharedArrayBuffer,
): { tick(nowMs: number): F; readonly newFrame: boolean } {
  const seqView = new Float64Array(buffer, 0, 1);
  let lastSeq = -1;
  let _newFrame = false;

  return {
    tick(nowMs: number): F {
      const seq = seqView[SEQUENCE_OFFSET];
      _newFrame = seq !== lastSeq;
      lastSeq = seq;
      return source.tick(nowMs);
    },
    get newFrame(): boolean {
      return _newFrame;
    },
  };
}

/**
 * Compute the required SharedArrayBuffer size for Float64Array mode.
 *
 * @param frameSize - Number of Float64 elements in the frame
 */
export function computeBufferSize(frameSize: number): number {
  // Header is 20 bytes, but Float64 alignment needs 24 bytes (3 × 8)
  return (3 + frameSize) * 8;
}

/**
 * Compute the required SharedArrayBuffer size for FlatBuffer mode.
 *
 * @param maxFrameBytes - Maximum frame size in bytes
 */
export function computeFlatBufferBufferSize(maxFrameBytes: number): number {
  return HEADER_BYTES + maxFrameBytes;
}
