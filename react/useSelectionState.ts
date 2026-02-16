/**
 * useSelectionState — Top-level selection state subscription.
 *
 * For selection indicators, count badges, mode displays, and focus tracking.
 * Re-renders only when selection-level state (mode, selectedCount, focusId, etc.) changes.
 *
 * Usage:
 *   const { mode, selectedCount, focusId } = useSelectionState(handle);
 *   <span>{selectedCount} items selected</span>
 */

import { useWasmSelector } from './useWasmSelector';
import type { SelectionHandle } from './useSelectionEngine';
import type { SelectionState } from '../core/types';

const EMPTY_STATE: SelectionState = {
  mode: 0,
  itemCount: 0,
  selectedCount: 0,
  focusId: '',
  anchorId: '',
  dataVersion: 0,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useSelectionState(
  handle: SelectionHandle | null,
): SelectionState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
      return {
        mode: engine.mode(),
        itemCount: engine.item_count(),
        selectedCount: engine.selected_count(),
        focusId: engine.focus(),
        anchorId: engine.anchor(),
        dataVersion: engine.data_version(),
      };
    },
  );
}
