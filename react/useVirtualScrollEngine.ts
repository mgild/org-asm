/**
 * useVirtualScrollEngine — Creates a VirtualScrollHandle wrapping a Rust IVirtualScrollEngine.
 *
 * The handle provides dispatch functions (setViewportHeight, setScrollOffset, scrollToIndex, etc.)
 * that mutate the engine and notify subscribers. Per-item and scroll-level
 * hooks (useVirtualScrollItem, useVirtualScrollState) subscribe via the notifier.
 *
 * Usage:
 *   const engine = useMemo(() => new MyVirtualScrollEngine(), []);
 *   const handle = useVirtualScrollEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.setViewportHeight(600);
 *   handle.setItemCount(1000);
 *   handle.setScrollOffset(150);
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { IVirtualScrollEngine } from '../core/interfaces';
import type { VirtualScrollState } from '../core/types';

export interface VirtualScrollHandle<E extends IVirtualScrollEngine = IVirtualScrollEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;

  // Dispatch functions (mutate engine + notify)
  setViewportHeight(height: number): void;
  setOverscanCount(count: number): void;
  setItemCount(count: number): void;
  setItemHeight(index: number, height: number): void;
  setDefaultItemHeight(height: number): void;
  setScrollOffset(offset: number): void;
  scrollToIndex(index: number): void;
  scrollToIndexAligned(index: number, align: number): void;
  setAnchor(index: number): void;
  clearAnchor(): void;
  reset(): void;

  // Reads (no notify)
  getVirtualScrollState(): VirtualScrollState;
  getItemTop(index: number): number;
  getItemHeight(index: number): number;
  isIndexVisible(index: number): boolean;
  getAnchorOffsetDelta(): number;
}

export function useVirtualScrollEngine<E extends IVirtualScrollEngine>(
  engine: E | null,
): VirtualScrollHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

    return {
      engine,
      notifier,

      setViewportHeight(height: number): void {
        engine.set_viewport_height(height);
        notifier.notify();
      },
      setOverscanCount(count: number): void {
        engine.set_overscan_count(count);
        notifier.notify();
      },
      setItemCount(count: number): void {
        engine.set_item_count(count);
        notifier.notify();
      },
      setItemHeight(index: number, height: number): void {
        engine.set_item_height(index, height);
        notifier.notify();
      },
      setDefaultItemHeight(height: number): void {
        engine.set_default_item_height(height);
        notifier.notify();
      },
      setScrollOffset(offset: number): void {
        engine.set_scroll_offset(offset);
        notifier.notify();
      },
      scrollToIndex(index: number): void {
        engine.scroll_to_index(index);
        notifier.notify();
      },
      scrollToIndexAligned(index: number, align: number): void {
        engine.scroll_to_index_aligned(index, align);
        notifier.notify();
      },
      setAnchor(index: number): void {
        engine.set_anchor(index);
        notifier.notify();
      },
      clearAnchor(): void {
        engine.clear_anchor();
        notifier.notify();
      },
      reset(): void {
        engine.reset();
        notifier.notify();
      },

      getVirtualScrollState(): VirtualScrollState {
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
      getItemTop(index: number): number {
        return engine.item_top(index);
      },
      getItemHeight(index: number): number {
        return engine.item_height(index);
      },
      isIndexVisible(index: number): boolean {
        return engine.is_index_visible(index);
      },
      getAnchorOffsetDelta(): number {
        return engine.anchor_offset_delta();
      },
    };
  }, [engine, notifier]);
}
