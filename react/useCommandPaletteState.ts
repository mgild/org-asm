/**
 * useCommandPaletteState — Top-level command palette state subscription.
 *
 * For search bars, result counts, pagination controls, and status indicators.
 * Re-renders only when palette-level state (query, resultCount, page, etc.) changes.
 *
 * Usage:
 *   const { query, resultCount, page, pageCount } = useCommandPaletteState(handle);
 *   <span>{resultCount} commands for "{query}"</span>
 */

import { useWasmSelector } from './useWasmSelector';
import type { CommandPaletteHandle } from './useCommandPaletteEngine';
import type { CommandPaletteState } from '../core/types';

const EMPTY_STATE: CommandPaletteState = {
  commandCount: 0,
  query: '',
  resultCount: 0,
  page: 0,
  pageSize: 50,
  pageCount: 0,
  lastExecutedId: '',
  dataVersion: 0,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useCommandPaletteState(
  handle: CommandPaletteHandle | null,
): CommandPaletteState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
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
  );
}
