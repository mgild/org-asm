/**
 * CommandBuilder + CommandSender — Typed FlatBuffer commands over WebSocket.
 *
 * Two-class pattern:
 * 1. Extend `CommandBuilder` with instance methods wrapping your generated FlatBuffer statics
 * 2. Extend `CommandSender<YourBuilder>` with typed command methods
 *
 * ## Usage
 *
 * ```typescript
 * import { CommandBuilder, CommandSender } from 'org-asm/controller';
 * import { CommandMessage } from './generated/org-asm/commands/command-message';
 * import { Subscribe } from './generated/org-asm/commands/subscribe';
 * import { Command } from './generated/org-asm/commands/command';
 *
 * // 1. Wrap generated statics as instance methods
 * class MyBuilder extends CommandBuilder {
 *   startSubscribe()                          { Subscribe.startSubscribe(this.fb); }
 *   addSymbol(o: flatbuffers.Offset)          { Subscribe.addSymbol(this.fb, o); }
 *   addDepth(d: number)                       { Subscribe.addDepth(this.fb, d); }
 *   endSubscribe()                            { return Subscribe.endSubscribe(this.fb); }
 *
 *   startCommandMessage()                     { CommandMessage.startCommandMessage(this.fb); }
 *   addId()                                   { CommandMessage.addId(this.fb, this.id); }
 *   addCommandType(t: Command)                { CommandMessage.addCommandType(this.fb, t); }
 *   addCommand(o: flatbuffers.Offset)         { CommandMessage.addCommand(this.fb, o); }
 *   endCommandMessage()                       { return CommandMessage.endCommandMessage(this.fb); }
 * }
 *
 * // 2. Typed command methods
 * class MyCommands extends CommandSender<MyBuilder> {
 *   constructor(pipeline: WebSocketPipeline) {
 *     super(pipeline, new MyBuilder());
 *   }
 *
 *   subscribe(symbol: string, depth = 20): bigint {
 *     return this.send(b => {
 *       const sym = b.createString(symbol);
 *       b.startSubscribe();
 *       b.addSymbol(sym);
 *       b.addDepth(depth);
 *       const sub = b.endSubscribe();
 *
 *       b.startCommandMessage();
 *       b.addId();
 *       b.addCommandType(Command.Subscribe);
 *       b.addCommand(sub);
 *       return b.endCommandMessage();
 *     });
 *   }
 * }
 *
 * // Clean typed API:
 * const commands = new MyCommands(pipeline);
 * commands.subscribe('BTC-USD', 20);
 * ```
 */

import * as flatbuffers from 'flatbuffers';
import type { WebSocketPipeline } from './WebSocketPipeline';

/**
 * Base class wrapping a FlatBuffers builder with reusable ID tracking.
 *
 * Extend with instance methods that delegate to your generated FlatBuffer statics.
 * This turns `Subscribe.startSubscribe(builder)` into `b.startSubscribe()`.
 */
export class CommandBuilder {
  /** The underlying FlatBuffers builder. */
  readonly fb: flatbuffers.Builder;
  /** Auto-incremented command ID, set before each send. */
  id: bigint = 0n;

  constructor(initialCapacity = 256) {
    this.fb = new flatbuffers.Builder(initialCapacity);
  }

  /** Create a string offset in the buffer. */
  createString(s: string): flatbuffers.Offset {
    return this.fb.createString(s);
  }

  /** Create a byte vector offset in the buffer. */
  createByteVector(bytes: Uint8Array): flatbuffers.Offset {
    return this.fb.createByteVector(bytes);
  }
}

/**
 * Base class for typed FlatBuffer command senders.
 *
 * Generic over a `CommandBuilder` subclass so `send` callbacks
 * receive your typed builder with schema-specific methods.
 */
export class CommandSender<B extends CommandBuilder = CommandBuilder> {
  protected pipeline: WebSocketPipeline;
  protected builder: B;
  private nextId: bigint = 0n;

  /**
   * @param pipeline - The pipeline to send binary commands through.
   * @param builder - Your CommandBuilder subclass instance (reused across calls).
   */
  constructor(pipeline: WebSocketPipeline, builder: B) {
    this.pipeline = pipeline;
    this.builder = builder;
  }

  /**
   * Build and send a FlatBuffer command over the pipeline.
   *
   * Resets the builder, sets the id, calls your build function,
   * then finishes and sends the bytes.
   *
   * @param buildFn - Receives the typed builder, returns the root table offset.
   * @returns The command id assigned (for correlation with server responses).
   */
  protected send(buildFn: (builder: B) => flatbuffers.Offset): bigint {
    const id = this.nextId;
    this.nextId += 1n;

    this.builder.id = id;
    this.builder.fb.clear();
    const offset = buildFn(this.builder);
    this.builder.fb.finish(offset);

    this.pipeline.sendBinary(this.builder.fb.asUint8Array());
    return id;
  }

  /**
   * The next command id that will be assigned.
   * Useful for pre-registering response handlers before sending.
   */
  get peekNextId(): bigint {
    return this.nextId;
  }
}
