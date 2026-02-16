/**
 * useVirtualScrollState — Top-level virtual scroll state subscription.
 *
 * For scroll containers, position indicators, and viewport controls.
 * Re-renders only when scroll-level state (offset, visible range, etc.) changes.
 *
 * Usage:
 *   const { visibleStart, visibleEnd, totalHeight } = useVirtualScrollState(handle);
 *   <div style={{ height: totalHeight }}>...</div>
 */

import { useWasmSelector } from './useWasmSelector';
import type { VirtualScrollHandle } from './useVirtualScrollEngine';
import type { VirtualScrollState } from '../core/types';

const EMPTY_STATE: VirtualScrollState = {
  itemCount: 0,
  viewportHeight: 0,
  overscanCount: 0,
  scrollOffset: 0,
  totalHeight: 0,
  visibleStart: 0,
  visibleEnd: 0,
  visibleCount: 0,
  defaultItemHeight: 40,
  anchor: -1,
  dataVersion: 0,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useVirtualScrollState(
  handle: VirtualScrollHandle | null,
): VirtualScrollState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
      return {
        itemCount: engine.item_count(),
        viewportHeight: engine.viewport_height(),
        overscanCount: engine.overscan_count(),
        scrollOffset: engine.scroll_offset(),
        totalHeight: engine.total_height(),
        visibleStart: engine.visible_start(),
        visibleEnd: engine.visible_end(),
        visibleCount: engine.visible_count(),
        defaultItemHeight: engine.default_item_height(),
        anchor: engine.anchor(),
        dataVersion: engine.data_version(),
      };
    },
  );
}
