/**
 * useHistoryState — History-level state subscription.
 *
 * For undo/redo buttons, save indicators, and checkpoint tracking.
 * Re-renders only when history-level state changes.
 *
 * Usage:
 *   const { canUndo, canRedo, hasUnsavedChanges } = useHistoryState(handle);
 *   <button disabled={!canUndo} onClick={() => handle?.undo()}>Undo</button>
 */

import { useWasmSelector } from './useWasmSelector';
import type { HistoryHandle } from './useHistoryEngine';
import type { HistoryState } from '../core/types';

const EMPTY_STATE: HistoryState = {
  canUndo: false,
  canRedo: false,
  undoCount: 0,
  redoCount: 0,
  isAtCheckpoint: true,
  hasUnsavedChanges: false,
  commandsSinceCheckpoint: 0,
  maxHistory: 100,
  dataVersion: 0,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useHistoryState(
  handle: HistoryHandle | null,
): HistoryState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
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
  );
}
