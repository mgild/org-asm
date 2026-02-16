/**
 * useUndoEntry — Per-entry undo subscription via useWasmSelector.
 *
 * Only this entry's component re-renders when its label changes.
 *
 * Usage:
 *   const { index, label } = useUndoEntry(handle, 0);
 *   <li>{label}</li>
 */

import { useWasmSelector } from './useWasmSelector';
import type { HistoryHandle } from './useHistoryEngine';
import type { CommandEntry } from '../core/types';

const EMPTY_ENTRY: CommandEntry = {
  index: -1,
  label: '',
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useUndoEntry(
  handle: HistoryHandle | null,
  index: number,
): CommandEntry {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_ENTRY;
      return {
        index,
        label: handle.engine.undo_label(index),
      };
    },
  );
}
