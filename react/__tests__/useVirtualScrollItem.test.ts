import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVirtualScrollItem } from '../useVirtualScrollItem';
import { createNotifier } from '../useWasmState';
import type { IVirtualScrollEngine } from '../../core/interfaces';
import type { VirtualScrollHandle } from '../useVirtualScrollEngine';
import type { VirtualScrollState } from '../../core/types';

function createMockEngine(): IVirtualScrollEngine {
  let itemCount = 0;
  let viewportHeight = 0;
  let overscanCount = 0;
  let scrollOffset = 0;
  let defaultItemHeight = 40;
  const itemHeights = new Map<number, number>();
  let anchor = -1;
  let version = 0;

  return {
    set_viewport_height(height: number) { viewportHeight = height; version++; },
    set_overscan_count(count: number) { overscanCount = count; version++; },
    viewport_height() { return viewportHeight; },
    overscan_count() { return overscanCount; },
    set_item_count(count: number) { itemCount = count; version++; },
    set_item_height(index: number, height: number) { itemHeights.set(index, height); version++; },
    set_default_item_height(height: number) { defaultItemHeight = height; version++; },
    item_height(index: number) { return itemHeights.get(index) ?? defaultItemHeight; },
    default_item_height() { return defaultItemHeight; },
    item_count() { return itemCount; },
    set_scroll_offset(offset: number) { scrollOffset = offset; version++; },
    scroll_offset() { return scrollOffset; },
    total_height() {
      let total = 0;
      for (let i = 0; i < itemCount; i++) {
        total += itemHeights.get(i) ?? defaultItemHeight;
      }
      return total;
    },
    visible_start() {
      let cumulative = 0;
      for (let i = 0; i < itemCount; i++) {
        const h = itemHeights.get(i) ?? defaultItemHeight;
        if (cumulative + h > scrollOffset) return Math.max(0, i - overscanCount);
        cumulative += h;
      }
      return 0;
    },
    visible_end() {
      const viewEnd = scrollOffset + viewportHeight;
      let cumulative = 0;
      for (let i = 0; i < itemCount; i++) {
        cumulative += itemHeights.get(i) ?? defaultItemHeight;
        if (cumulative >= viewEnd) return Math.min(itemCount, i + 1 + overscanCount);
      }
      return itemCount;
    },
    visible_count() {
      return this.visible_end() - this.visible_start();
    },
    item_top(index: number) {
      let top = 0;
      for (let i = 0; i < index && i < itemCount; i++) {
        top += itemHeights.get(i) ?? defaultItemHeight;
      }
      return top;
    },
    item_bottom(index: number) {
      return this.item_top(index) + (itemHeights.get(index) ?? defaultItemHeight);
    },
    scroll_to_index(index: number) {
      scrollOffset = this.item_top(index);
      version++;
    },
    scroll_to_index_aligned(index: number, align: number) {
      const top = this.item_top(index);
      const h = itemHeights.get(index) ?? defaultItemHeight;
      if (align === 0) scrollOffset = top;
      else if (align === 1) scrollOffset = Math.max(0, top - viewportHeight / 2 + h / 2);
      else if (align === 2) scrollOffset = Math.max(0, top + h - viewportHeight);
      version++;
    },
    is_index_visible(index: number) {
      const top = this.item_top(index);
      const bottom = top + (itemHeights.get(index) ?? defaultItemHeight);
      return bottom > scrollOffset && top < scrollOffset + viewportHeight;
    },
    set_anchor(index: number) { anchor = index; version++; },
    anchor() { return anchor; },
    clear_anchor() { anchor = -1; version++; },
    anchor_offset_delta() { return 0; },
    data_version() { return version; },
    reset() {
      itemCount = 0; viewportHeight = 0; overscanCount = 0;
      scrollOffset = 0; defaultItemHeight = 40; itemHeights.clear();
      anchor = -1; version++;
    },
  };
}

function createHandle(engine: IVirtualScrollEngine): VirtualScrollHandle {
  const notifier = createNotifier();
  return {
    engine,
    notifier,
    setViewportHeight(height: number): void { engine.set_viewport_height(height); notifier.notify(); },
    setOverscanCount(count: number): void { engine.set_overscan_count(count); notifier.notify(); },
    setItemCount(count: number): void { engine.set_item_count(count); notifier.notify(); },
    setItemHeight(index: number, height: number): void { engine.set_item_height(index, height); notifier.notify(); },
    setDefaultItemHeight(height: number): void { engine.set_default_item_height(height); notifier.notify(); },
    setScrollOffset(offset: number): void { engine.set_scroll_offset(offset); notifier.notify(); },
    scrollToIndex(index: number): void { engine.scroll_to_index(index); notifier.notify(); },
    scrollToIndexAligned(index: number, align: number): void { engine.scroll_to_index_aligned(index, align); notifier.notify(); },
    setAnchor(index: number): void { engine.set_anchor(index); notifier.notify(); },
    clearAnchor(): void { engine.clear_anchor(); notifier.notify(); },
    reset(): void { engine.reset(); notifier.notify(); },
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
    getItemTop(index: number): number { return engine.item_top(index); },
    getItemHeight(index: number): number { return engine.item_height(index); },
    isIndexVisible(index: number): boolean { return engine.is_index_visible(index); },
    getAnchorOffsetDelta(): number { return engine.anchor_offset_delta(); },
  };
}

describe('useVirtualScrollItem', () => {
  it('returns empty VirtualScrollItem when handle is null', () => {
    const { result } = renderHook(() => useVirtualScrollItem(null, 0));
    expect(result.current).toEqual({
      index: 0,
      top: 0,
      height: 0,
      isVisible: false,
    });
  });

  it('returns correct item state (index, top, height, isVisible) when item exists', () => {
    const engine = createMockEngine();
    engine.set_item_count(10);
    engine.set_viewport_height(400);
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollItem(handle, 2));

    expect(result.current.index).toBe(2);
    expect(result.current.top).toBe(80); // 2 * 40
    expect(result.current.height).toBe(40); // default
    expect(result.current.isVisible).toBe(true);
  });

  it('returns isVisible=false when item is out of viewport', () => {
    const engine = createMockEngine();
    engine.set_item_count(100);
    engine.set_viewport_height(200);
    engine.set_scroll_offset(0);
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollItem(handle, 50));

    expect(result.current.index).toBe(50);
    expect(result.current.top).toBe(2000); // 50 * 40
    expect(result.current.height).toBe(40);
    expect(result.current.isVisible).toBe(false);
  });

  it('returns correct item with custom height', () => {
    const engine = createMockEngine();
    engine.set_item_count(10);
    engine.set_viewport_height(400);
    engine.set_item_height(0, 100);
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollItem(handle, 1));

    expect(result.current.index).toBe(1);
    expect(result.current.top).toBe(100); // item 0 is 100px tall
    expect(result.current.height).toBe(40); // item 1 uses default
    expect(result.current.isVisible).toBe(true);
  });

  it('reflects is_index_visible correctly', () => {
    const engine = createMockEngine();
    engine.set_item_count(20);
    engine.set_viewport_height(200);
    engine.set_scroll_offset(0);
    const handle = createHandle(engine);

    // Item 4: top=160, bottom=200 — visible (bottom > 0 && top < 200)
    const { result: result4 } = renderHook(() => useVirtualScrollItem(handle, 4));
    expect(result4.current.isVisible).toBe(true);

    // Item 5: top=200, bottom=240 — not visible (top >= viewport end)
    const { result: result5 } = renderHook(() => useVirtualScrollItem(handle, 5));
    expect(result5.current.isVisible).toBe(false);
  });

  it('updates on notify (re-renders with new item state)', () => {
    const engine = createMockEngine();
    engine.set_item_count(10);
    engine.set_viewport_height(200);
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollItem(handle, 0));
    expect(result.current.height).toBe(40);
    expect(result.current.isVisible).toBe(true);

    act(() => {
      handle.setItemHeight(0, 80);
    });

    expect(result.current.height).toBe(80);
  });

  it('reflects scroll offset changes', () => {
    const engine = createMockEngine();
    engine.set_item_count(100);
    engine.set_viewport_height(200);
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollItem(handle, 0));
    expect(result.current.isVisible).toBe(true);

    act(() => {
      handle.setScrollOffset(400);
    });

    // Item 0: top=0, bottom=40, scrollOffset=400 — not visible
    expect(result.current.isVisible).toBe(false);
  });

  it('returns empty item for handle with zero items', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollItem(handle, 0));

    expect(result.current).toEqual({
      index: 0,
      top: 0,
      height: 40, // default item height
      isVisible: false, // no viewport, no items
    });
  });
});
