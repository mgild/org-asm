/**
 * CommandSender — Sends binary FlatBuffer commands over a WebSocketPipeline.
 *
 * Encapsulates the FlatBuffer builder lifecycle: reset, build, finish, send.
 * The builder is reused across calls to avoid repeated allocation (same pattern
 * as the Rust engine's FlatBufferBuilder reuse in tick()).
 *
 * Each command gets a monotonically increasing id for request/response correlation.
 * The server can echo the id back in acknowledgements so the client knows which
 * command was processed.
 *
 * ## Usage
 *
 * ```typescript
 * import * as flatbuffers from 'flatbuffers';
 * import { CommandSender } from 'org-asm/controller';
 * import { CommandMessage } from './generated/org-asm/commands/command-message';
 * import { Subscribe } from './generated/org-asm/commands/subscribe';
 * import { Command } from './generated/org-asm/commands/command';
 *
 * const sender = new CommandSender(pipeline);
 *
 * // Send a Subscribe command
 * sender.send((builder, id) => {
 *   const symbolOffset = builder.createString('BTC-USD');
 *   Subscribe.startSubscribe(builder);
 *   Subscribe.addSymbol(builder, symbolOffset);
 *   Subscribe.addDepth(builder, 20);
 *   const subOffset = Subscribe.endSubscribe(builder);
 *
 *   CommandMessage.startCommandMessage(builder);
 *   CommandMessage.addId(builder, id);
 *   CommandMessage.addCommandType(builder, Command.Subscribe);
 *   CommandMessage.addCommand(builder, subOffset);
 *   return CommandMessage.endCommandMessage(builder);
 * });
 *
 * // Send an Unsubscribe command
 * sender.send((builder, id) => {
 *   const symbolOffset = builder.createString('BTC-USD');
 *   Unsubscribe.startUnsubscribe(builder);
 *   Unsubscribe.addSymbol(builder, symbolOffset);
 *   const unsubOffset = Unsubscribe.endUnsubscribe(builder);
 *
 *   CommandMessage.startCommandMessage(builder);
 *   CommandMessage.addId(builder, id);
 *   CommandMessage.addCommandType(builder, Command.Unsubscribe);
 *   CommandMessage.addCommand(builder, unsubOffset);
 *   return CommandMessage.endCommandMessage(builder);
 * });
 * ```
 */

import * as flatbuffers from 'flatbuffers';
import type { WebSocketPipeline } from './WebSocketPipeline';

/**
 * Function that builds a FlatBuffer command message.
 *
 * Receives the builder (already reset) and the auto-incremented command id.
 * Must create the CommandMessage table and return its offset.
 * The caller (CommandSender) handles `builder.finish()` and sending.
 *
 * @param builder - The FlatBufferBuilder to use (already reset, ready for building)
 * @param id - Auto-incremented command id (bigint for uint64 compatibility)
 * @returns The offset of the finished CommandMessage table
 */
export type CommandBuildFn = (
  builder: flatbuffers.Builder,
  id: bigint,
) => flatbuffers.Offset;

export class CommandSender {
  private pipeline: WebSocketPipeline;
  private builder: flatbuffers.Builder;
  private nextId: bigint;

  /**
   * Create a CommandSender bound to a WebSocketPipeline.
   *
   * @param pipeline - The pipeline to send binary commands through.
   *   Must be connected (sendBinary silently drops if not connected).
   * @param initialCapacity - Initial FlatBufferBuilder capacity in bytes (default: 256).
   *   The builder grows automatically if needed.
   */
  constructor(pipeline: WebSocketPipeline, initialCapacity = 256) {
    this.pipeline = pipeline;
    this.builder = new flatbuffers.Builder(initialCapacity);
    this.nextId = 0n;
  }

  /**
   * Build and send a FlatBuffer command over the pipeline.
   *
   * The buildFn receives the builder (already reset) and an auto-incremented id.
   * It should create the full CommandMessage table and return the offset.
   * CommandSender calls `builder.finish()` and sends the resulting bytes.
   *
   * @param buildFn - Function that builds the CommandMessage and returns its offset.
   * @returns The command id that was assigned (for correlation with server responses).
   */
  send(buildFn: CommandBuildFn): bigint {
    const id = this.nextId;
    this.nextId += 1n;

    this.builder.clear();
    const offset = buildFn(this.builder, id);
    this.builder.finish(offset);

    const bytes = this.builder.asUint8Array();
    this.pipeline.sendBinary(bytes);

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
