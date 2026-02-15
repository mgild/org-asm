/**
 * CommandBuilder + CommandSender — Typed FlatBuffer commands over WebSocket.
 *
 * Two-class pattern:
 * 1. Generate a `CommandBuilder` subclass from your `.fbs` schema:
 *    `npx org-asm gen-builder schema/commands.fbs -o src/generated/`
 * 2. Extend `CommandSender<YourBuilder>` with typed command methods
 *
 * ## Usage
 *
 * ```typescript
 * import { CommandSender } from 'org-asm/controller';
 * import { CommandsBuilder } from './generated/CommandsBuilder';
 * import { Command } from './generated/org-asm/commands/command';
 *
 * class MyCommands extends CommandSender<CommandsBuilder> {
 *   constructor(pipeline: WebSocketPipeline) {
 *     super(pipeline, new CommandsBuilder());
 *   }
 *
 *   subscribe(symbol: string, depth = 20): bigint {
 *     return this.send(b => {
 *       const sym = b.createString(symbol);
 *       const sub = b.subscribe.start().addSymbol(sym).addDepth(depth).end();
 *       return b.commandMessage.start()
 *         .addId(b.id)
 *         .addCommandType(Command.Subscribe)
 *         .addCommand(sub)
 *         .end();
 *     });
 *   }
 * }
 *
 * const commands = new MyCommands(pipeline);
 * commands.subscribe('BTC-USD', 20);
 * ```
 */

import * as flatbuffers from 'flatbuffers';
import type { WebSocketPipeline } from './WebSocketPipeline';
import type { ResponseRegistry } from './ResponseRegistry';

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
export class CommandSender<B extends CommandBuilder = CommandBuilder, R = ArrayBuffer> {
  protected pipeline: WebSocketPipeline;
  protected builder: B;
  private nextId: bigint = 0n;
  protected responseRegistry: ResponseRegistry<R> | null = null;

  constructor(pipeline: WebSocketPipeline, builder: B) {
    this.pipeline = pipeline;
    this.builder = builder;
  }

  /** Attach a ResponseRegistry for sendWithResponse support. */
  setResponseRegistry(registry: ResponseRegistry<R>): void {
    this.responseRegistry = registry;
  }

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
   * Build, send, and await a response for a FlatBuffer command.
   * Requires a ResponseRegistry to be set via setResponseRegistry().
   */
  protected sendWithResponse(buildFn: (builder: B) => flatbuffers.Offset): Promise<R> {
    if (!this.responseRegistry) {
      throw new Error('CommandSender: sendWithResponse requires a ResponseRegistry. Call setResponseRegistry() first.');
    }
    const id = this.send(buildFn);
    return this.responseRegistry.register(id);
  }

  get peekNextId(): bigint {
    return this.nextId;
  }
}
