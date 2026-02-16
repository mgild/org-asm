/**
 * useHistoryEngine — Creates a HistoryHandle wrapping a Rust IHistoryEngine.
 *
 * The handle provides dispatch functions (pushCommand, undo, redo, checkpoint, etc.)
 * that mutate the engine and notify subscribers. History-level and per-entry
 * hooks subscribe via the notifier to re-render on changes.
 *
 * Usage:
 *   const engine = useMemo(() => new MyHistoryEngine(), []);
 *   const handle = useHistoryEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.pushCommand(JSON.stringify({ type: 'setField', field: 'name', prev: 'A', next: 'B' }));
 *   const cmd = handle.undo(); // returns the JSON to reverse
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { IHistoryEngine } from '../core/interfaces';
import type { HistoryState } from '../core/types';

export interface HistoryHandle<E extends IHistoryEngine = IHistoryEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;
  // Dispatch (mutate + notify)
  pushCommand(json: string): void;
  pushBatch(json: string): void;
  undo(): string;
  redo(): string;
  checkpoint(): void;
  clearHistory(): void;
  clearRedo(): void;
  setMaxHistory(max: number): void;
  reset(): void;
  // Reads (no notify)
  getHistoryState(): HistoryState;
  lastCommand(): string;
  undoLabel(index: number): string;
  redoLabel(index: number): string;
}

export function useHistoryEngine<E extends IHistoryEngine>(
  engine: E | null,
): HistoryHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

    return {
      engine,
      notifier,
      pushCommand(json: string): void {
        engine.push_command(json);
        notifier.notify();
      },
      pushBatch(json: string): void {
        engine.push_batch(json);
        notifier.notify();
      },
      undo(): string {
        const result = engine.undo();
        notifier.notify();
        return result;
      },
      redo(): string {
        const result = engine.redo();
        notifier.notify();
        return result;
      },
      checkpoint(): void {
        engine.checkpoint();
        notifier.notify();
      },
      clearHistory(): void {
        engine.clear_history();
        notifier.notify();
      },
      clearRedo(): void {
        engine.clear_redo();
        notifier.notify();
      },
      setMaxHistory(max: number): void {
        engine.set_max_history(max);
        notifier.notify();
      },
      reset(): void {
        engine.reset();
        notifier.notify();
      },
      getHistoryState(): HistoryState {
        return {
          canUndo: engine.can_undo(),
          canRedo: engine.can_redo(),
          undoCount: engine.undo_count(),
          redoCount: engine.redo_count(),
          isAtCheckpoint: engine.is_at_checkpoint(),
          hasUnsavedChanges: engine.has_unsaved_changes(),
          commandsSinceCheckpoint: engine.commands_since_checkpoint(),
          maxHistory: engine.max_history(),
          dataVersion: engine.data_version(),
        };
      },
      lastCommand(): string {
        return engine.last_command();
      },
      undoLabel(index: number): string {
        return engine.undo_label(index);
      },
      redoLabel(index: number): string {
        return engine.redo_label(index);
      },
    };
  }, [engine, notifier]);
}
