import type {
  FrameFieldDescriptor,
  FrameBufferSchema,
  FrameAccessor,
} from './types';

/**
 * FrameBufferFactory — Creates type-safe accessors for flat f64 frame buffers.
 *
 * The key insight: WASM returns a flat Float64Array to minimize boundary crossings.
 * This class provides named access without runtime overhead (offsets are constant-folded).
 *
 * Usage:
 *   const schema = FrameBufferFactory.createSchema([
 *     { name: 'VALUE', offset: 0, type: 'f64' },
 *     { name: 'IS_ACTIVE', offset: 1, type: 'bool' },
 *     { name: 'STATE_R', offset: 2, type: 'u8' },
 *   ]);
 *   const offsets = FrameBufferFactory.createOffsets(schema);
 *   // offsets.VALUE === 0, offsets.IS_ACTIVE === 1, etc.
 *   // Use: frame[offsets.VALUE]
 */
export class FrameBufferFactory {
  /**
   * Create a schema from field descriptors.
   * Validates no offset collisions and computes total size.
   *
   * @throws Error if two fields share the same offset
   */
  static createSchema(fields: FrameFieldDescriptor[]): FrameBufferSchema {
    const seen = new Set<number>();
    for (const f of fields) {
      if (seen.has(f.offset)) {
        throw new Error(`Duplicate offset ${f.offset} for field "${f.name}"`);
      }
      seen.add(f.offset);
    }
    const size =
      fields.length > 0 ? Math.max(...fields.map((f) => f.offset)) + 1 : 0;
    return { fields: Object.freeze([...fields]), size };
  }

  /**
   * Create a const offset map from schema.
   * Returns { FIELD_NAME: offset, ... } for use as frame[offsets.FIELD_NAME].
   *
   * The returned object is frozen so offsets can be treated as compile-time constants
   * by JS engines (V8 will inline the property lookups in hot loops).
   */
  static createOffsets<T extends string>(
    schema: FrameBufferSchema
  ): Readonly<Record<T, number>> {
    const offsets: Record<string, number> = {};
    for (const f of schema.fields) {
      offsets[f.name] = f.offset;
    }
    return Object.freeze(offsets) as Readonly<Record<T, number>>;
  }

  /**
   * Create a type-safe accessor wrapping a raw Float64Array.
   *
   * Use for debugging/development. In production, use raw offsets for speed —
   * the accessor adds a property lookup per access that hot rendering loops
   * should avoid.
   */
  static createAccessor<S extends Record<string, number>>(
    raw: Float64Array,
    offsets: S
  ): FrameAccessor<S> {
    return {
      raw,
      get(field: keyof S): number {
        return raw[offsets[field as string]];
      },
      getBool(field: keyof S): boolean {
        return raw[offsets[field as string]] > 0.5;
      },
      getU8(field: keyof S): number {
        return Math.round(raw[offsets[field as string]]);
      },
    };
  }

  /**
   * Validate that a frame buffer matches the expected schema size.
   *
   * Call this once after the first tick() to catch schema mismatches early
   * (e.g. Rust engine was compiled with a different field count than JS expects).
   */
  static validate(frame: Float64Array, schema: FrameBufferSchema): boolean {
    return frame.length >= schema.size;
  }
}

/**
 * Create a tick adapter that reads a FlatBuffer frame from WASM linear memory.
 *
 * The engine's tick() writes a FlatBuffer into its internal buffer.
 * This adapter creates a Uint8Array view of the raw bytes, then calls
 * rootFn to deserialize the FlatBuffer table — giving you a typed frame
 * object with accessor methods (e.g., frame.intensity(), frame.colorR()).
 *
 * Plugs directly into AnimationLoop<F> which expects { tick(nowMs): F }.
 *
 * Usage:
 *   import { Frame } from './generated/frame';
 *   import { ByteBuffer } from 'flatbuffers';
 *
 *   const tick = flatBufferTickAdapter(
 *     engine, wasm.memory,
 *     bytes => Frame.getRootAsFrame(new ByteBuffer(bytes)),
 *   );
 *   const loop = new AnimationLoop(tick);
 *   effects.bindCSSProperty('root', '--glow', f => f.valueA());
 */
export function flatBufferTickAdapter<F>(
  engine: { tick(nowMs: number): void; frame_ptr(): number; frame_len(): number },
  memory: WebAssembly.Memory,
  rootFn: (bytes: Uint8Array) => F,
): { tick(nowMs: number): F } {
  return {
    tick(nowMs: number): F {
      engine.tick(nowMs);
      const bytes = new Uint8Array(memory.buffer, engine.frame_ptr(), engine.frame_len());
      return rootFn(bytes);
    },
  };
}

