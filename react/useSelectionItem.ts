/**
 * useSelectionItem — Per-item selection subscription via useWasmSelector.
 *
 * Only this item's component re-renders when its selection/focus state changes.
 * Other items remain untouched thanks to structural equality.
 *
 * Usage:
 *   const { id, isSelected, isFocused, index } = useSelectionItem(handle, 'item-1');
 *   if (isSelected) {
 *     <div className="selected">{id}</div>
 *   }
 */

import { useWasmSelector } from './useWasmSelector';
import type { SelectionHandle } from './useSelectionEngine';
import type { SelectionItem } from '../core/types';

const EMPTY_ITEM: SelectionItem = {
  id: '',
  isSelected: false,
  isFocused: false,
  index: -1,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useSelectionItem(
  handle: SelectionHandle | null,
  id: string,
): SelectionItem {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_ITEM;
      const { engine } = handle;
      return {
        id,
        isSelected: engine.is_selected(id),
        isFocused: engine.is_focused(id),
        index: engine.item_index(id),
      };
    },
  );
}
