import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVirtualScrollState } from '../useVirtualScrollState';
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

describe('useVirtualScrollState', () => {
  it('returns empty VirtualScrollState when handle is null', () => {
    const { result } = renderHook(() => useVirtualScrollState(null));
    expect(result.current).toEqual({
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
    });
  });

  it('returns correct scroll state', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollState(handle));

    expect(result.current).toEqual({
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
    });
  });

  it('reflects scrollOffset after setScrollOffset', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollState(handle));
    expect(result.current.scrollOffset).toBe(0);

    act(() => {
      handle.setScrollOffset(150);
    });

    expect(result.current.scrollOffset).toBe(150);
    expect(result.current.dataVersion).toBeGreaterThan(0);
  });

  it('reflects itemCount after setItemCount', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollState(handle));
    expect(result.current.itemCount).toBe(0);

    act(() => {
      handle.setItemCount(50);
    });

    expect(result.current.itemCount).toBe(50);
    expect(result.current.totalHeight).toBe(2000); // 50 * 40
  });

  it('reflects viewportHeight after setViewportHeight', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollState(handle));
    expect(result.current.viewportHeight).toBe(0);

    act(() => {
      handle.setViewportHeight(600);
    });

    expect(result.current.viewportHeight).toBe(600);
  });

  it('reflects overscanCount after setOverscanCount', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollState(handle));
    expect(result.current.overscanCount).toBe(0);

    act(() => {
      handle.setOverscanCount(3);
    });

    expect(result.current.overscanCount).toBe(3);
  });

  it('reflects anchor after setAnchor', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollState(handle));
    expect(result.current.anchor).toBe(-1);

    act(() => {
      handle.setAnchor(7);
    });

    expect(result.current.anchor).toBe(7);
  });

  it('updates on notify', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useVirtualScrollState(handle));
    const initialVersion = result.current.dataVersion;

    act(() => {
      handle.setItemCount(20);
    });

    expect(result.current.dataVersion).toBeGreaterThan(initialVersion);

    act(() => {
      handle.reset();
    });

    expect(result.current.itemCount).toBe(0);
    expect(result.current.viewportHeight).toBe(0);
    expect(result.current.scrollOffset).toBe(0);
    expect(result.current.anchor).toBe(-1);
  });
});
