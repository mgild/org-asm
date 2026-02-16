/**
 * useCommandPaletteEngine — Creates a CommandPaletteHandle wrapping a Rust ICommandPaletteEngine.
 *
 * The handle provides dispatch functions (registerCommand, setQuery, markExecuted, etc.)
 * that mutate the engine and notify subscribers. Per-result and palette-level
 * hooks (useCommandPaletteResult, useCommandPaletteState) subscribe via the notifier.
 *
 * Usage:
 *   const engine = useMemo(() => new MyCommandPaletteEngine(), []);
 *   const handle = useCommandPaletteEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.setQuery('open file');
 *   handle.markExecuted('file.open');
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { ICommandPaletteEngine } from '../core/interfaces';
import type { CommandPaletteState } from '../core/types';

export interface CommandPaletteHandle<E extends ICommandPaletteEngine = ICommandPaletteEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;

  // Dispatch functions (mutate engine + notify)
  registerCommand(id: string, label: string, category: string, keybinding: string): void;
  unregisterCommand(id: string): void;
  setEnabled(id: string, enabled: boolean): void;
  setQuery(text: string): void;
  setKeybinding(commandId: string, keybinding: string): void;
  markExecuted(id: string): void;
  setPage(page: number): void;
  setPageSize(size: number): void;
  reset(): void;

  // Reads (no notify)
  getCommandPaletteState(): CommandPaletteState;
  resolveKeybinding(keyCombo: string): string;
  getKeybinding(commandId: string): string;
  getExecutionCount(id: string): number;
  isEnabled(id: string): boolean;
}

export function useCommandPaletteEngine<E extends ICommandPaletteEngine>(
  engine: E | null,
): CommandPaletteHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

    return {
      engine,
      notifier,

      registerCommand(id: string, label: string, category: string, keybinding: string): void {
        engine.register_command(id, label, category, keybinding);
        notifier.notify();
      },
      unregisterCommand(id: string): void {
        engine.unregister_command(id);
        notifier.notify();
      },
      setEnabled(id: string, enabled: boolean): void {
        engine.set_enabled(id, enabled);
        notifier.notify();
      },
      setQuery(text: string): void {
        engine.set_query(text);
        notifier.notify();
      },
      setKeybinding(commandId: string, keybinding: string): void {
        engine.set_keybinding(commandId, keybinding);
        notifier.notify();
      },
      markExecuted(id: string): void {
        engine.mark_executed(id);
        notifier.notify();
      },
      setPage(page: number): void {
        engine.set_page(page);
        notifier.notify();
      },
      setPageSize(size: number): void {
        engine.set_page_size(size);
        notifier.notify();
      },
      reset(): void {
        engine.reset();
        notifier.notify();
      },

      getCommandPaletteState(): CommandPaletteState {
        return {
          commandCount: engine.command_count(),
          query: engine.query(),
          resultCount: engine.result_count(),
          page: engine.page(),
          pageSize: engine.page_size(),
          pageCount: engine.page_count(),
          lastExecutedId: engine.last_executed_id(),
          dataVersion: engine.data_version(),
        };
      },
      resolveKeybinding(keyCombo: string): string {
        return engine.resolve_keybinding(keyCombo);
      },
      getKeybinding(commandId: string): string {
        return engine.keybinding(commandId);
      },
      getExecutionCount(id: string): number {
        return engine.execution_count(id);
      },
      isEnabled(id: string): boolean {
        return engine.is_enabled(id);
      },
    };
  }, [engine, notifier]);
}
