/**
 * useVirtualScrollItem — Per-item subscription via useWasmSelector.
 *
 * Only this item's component re-renders when its state changes.
 * Other items remain untouched thanks to structural equality.
 *
 * Usage:
 *   const { top, height, isVisible } = useVirtualScrollItem(handle, 0);
 *   if (isVisible) {
 *     <div style={{ position: 'absolute', top, height }}>...</div>
 *   }
 */

import { useWasmSelector } from './useWasmSelector';
import type { VirtualScrollHandle } from './useVirtualScrollEngine';
import type { VirtualScrollItem } from '../core/types';

const EMPTY_ITEM: VirtualScrollItem = {
  index: 0,
  top: 0,
  height: 0,
  isVisible: false,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useVirtualScrollItem(
  handle: VirtualScrollHandle | null,
  index: number,
): VirtualScrollItem {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_ITEM;
      const { engine } = handle;
      const top = engine.item_top(index);
      const height = engine.item_height(index);
      const isVisible = engine.is_index_visible(index);
      return { index, top, height, isVisible };
    },
  );
}
