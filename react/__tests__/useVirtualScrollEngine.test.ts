import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVirtualScrollEngine } from '../useVirtualScrollEngine';
import type { IVirtualScrollEngine } from '../../core/interfaces';

function createMockEngine(): IVirtualScrollEngine & {
  _itemCount: number;
  _viewportHeight: number;
  _overscanCount: number;
  _scrollOffset: number;
  _defaultItemHeight: number;
  _itemHeights: Map<number, number>;
  _anchor: number;
} {
  let itemCount = 0;
  let viewportHeight = 0;
  let overscanCount = 0;
  let scrollOffset = 0;
  let defaultItemHeight = 40;
  const itemHeights = new Map<number, number>();
  let anchor = -1;
  let version = 0;

  return {
    _itemCount: itemCount,
    _viewportHeight: viewportHeight,
    _overscanCount: overscanCount,
    _scrollOffset: scrollOffset,
    _defaultItemHeight: defaultItemHeight,
    _itemHeights: itemHeights,
    _anchor: anchor,

    set_viewport_height(height: number) {
      viewportHeight = height;
      (this as ReturnType<typeof createMockEngine>)._viewportHeight = height;
      version++;
    },
    set_overscan_count(count: number) {
      overscanCount = count;
      (this as ReturnType<typeof createMockEngine>)._overscanCount = count;
      version++;
    },
    viewport_height() { return viewportHeight; },
    overscan_count() { return overscanCount; },

    set_item_count(count: number) {
      itemCount = count;
      (this as ReturnType<typeof createMockEngine>)._itemCount = count;
      version++;
    },
    set_item_height(index: number, height: number) {
      itemHeights.set(index, height);
      version++;
    },
    set_default_item_height(height: number) {
      defaultItemHeight = height;
      (this as ReturnType<typeof createMockEngine>)._defaultItemHeight = height;
      version++;
    },
    item_height(index: number) {
      return itemHeights.get(index) ?? defaultItemHeight;
    },
    default_item_height() { return defaultItemHeight; },
    item_count() { return itemCount; },

    set_scroll_offset(offset: number) {
      scrollOffset = offset;
      (this as ReturnType<typeof createMockEngine>)._scrollOffset = offset;
      version++;
    },
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
        if (cumulative + h > scrollOffset) {
          return Math.max(0, i - overscanCount);
        }
        cumulative += h;
      }
      return 0;
    },
    visible_end() {
      const viewEnd = scrollOffset + viewportHeight;
      let cumulative = 0;
      for (let i = 0; i < itemCount; i++) {
        cumulative += itemHeights.get(i) ?? defaultItemHeight;
        if (cumulative >= viewEnd) {
          return Math.min(itemCount, i + 1 + overscanCount);
        }
      }
      return itemCount;
    },
    visible_count() {
      const start = this.visible_start();
      const end = this.visible_end();
      return end - start;
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
      (this as ReturnType<typeof createMockEngine>)._scrollOffset = scrollOffset;
      version++;
    },
    scroll_to_index_aligned(index: number, align: number) {
      const top = this.item_top(index);
      const h = itemHeights.get(index) ?? defaultItemHeight;
      if (align === 0) { // Start
        scrollOffset = top;
      } else if (align === 1) { // Center
        scrollOffset = top - viewportHeight / 2 + h / 2;
      } else if (align === 2) { // End
        scrollOffset = top + h - viewportHeight;
      }
      scrollOffset = Math.max(0, scrollOffset);
      (this as ReturnType<typeof createMockEngine>)._scrollOffset = scrollOffset;
      version++;
    },
    is_index_visible(index: number) {
      const top = this.item_top(index);
      const bottom = top + (itemHeights.get(index) ?? defaultItemHeight);
      return bottom > scrollOffset && top < scrollOffset + viewportHeight;
    },

    set_anchor(index: number) {
      anchor = index;
      (this as ReturnType<typeof createMockEngine>)._anchor = index;
      version++;
    },
    anchor() { return anchor; },
    clear_anchor() {
      anchor = -1;
      (this as ReturnType<typeof createMockEngine>)._anchor = -1;
      version++;
    },
    anchor_offset_delta() {
      return 0; // Simplified for mock
    },

    data_version() { return version; },
    reset() {
      itemCount = 0;
      (this as ReturnType<typeof createMockEngine>)._itemCount = 0;
      viewportHeight = 0;
      (this as ReturnType<typeof createMockEngine>)._viewportHeight = 0;
      overscanCount = 0;
      (this as ReturnType<typeof createMockEngine>)._overscanCount = 0;
      scrollOffset = 0;
      (this as ReturnType<typeof createMockEngine>)._scrollOffset = 0;
      defaultItemHeight = 40;
      (this as ReturnType<typeof createMockEngine>)._defaultItemHeight = 40;
      itemHeights.clear();
      anchor = -1;
      (this as ReturnType<typeof createMockEngine>)._anchor = -1;
      version++;
    },
  };
}

describe('useVirtualScrollEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useVirtualScrollEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns VirtualScrollHandle with all methods when engine is provided', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.notifier.subscribe).toBe('function');
    expect(typeof handle.notifier.notify).toBe('function');
    expect(typeof handle.setViewportHeight).toBe('function');
    expect(typeof handle.setOverscanCount).toBe('function');
    expect(typeof handle.setItemCount).toBe('function');
    expect(typeof handle.setItemHeight).toBe('function');
    expect(typeof handle.setDefaultItemHeight).toBe('function');
    expect(typeof handle.setScrollOffset).toBe('function');
    expect(typeof handle.scrollToIndex).toBe('function');
    expect(typeof handle.scrollToIndexAligned).toBe('function');
    expect(typeof handle.setAnchor).toBe('function');
    expect(typeof handle.clearAnchor).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getVirtualScrollState).toBe('function');
    expect(typeof handle.getItemTop).toBe('function');
    expect(typeof handle.getItemHeight).toBe('function');
    expect(typeof handle.isIndexVisible).toBe('function');
    expect(typeof handle.getAnchorOffsetDelta).toBe('function');
  });

  it('setViewportHeight calls engine.set_viewport_height and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setViewportHeight(600);
    });

    expect(engine.viewport_height()).toBe(600);
    expect(spy).toHaveBeenCalled();
  });

  it('setOverscanCount calls engine.set_overscan_count and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setOverscanCount(5);
    });

    expect(engine.overscan_count()).toBe(5);
    expect(spy).toHaveBeenCalled();
  });

  it('setItemCount calls engine.set_item_count and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setItemCount(100);
    });

    expect(engine.item_count()).toBe(100);
    expect(spy).toHaveBeenCalled();
  });

  it('setItemHeight calls engine.set_item_height and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItemCount(10);
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setItemHeight(3, 80);
    });

    expect(engine.item_height(3)).toBe(80);
    expect(spy).toHaveBeenCalled();
  });

  it('setDefaultItemHeight calls engine.set_default_item_height and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setDefaultItemHeight(60);
    });

    expect(engine.default_item_height()).toBe(60);
    expect(spy).toHaveBeenCalled();
  });

  it('setScrollOffset calls engine.set_scroll_offset and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setScrollOffset(200);
    });

    expect(engine.scroll_offset()).toBe(200);
    expect(spy).toHaveBeenCalled();
  });

  it('scrollToIndex calls engine.scroll_to_index and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItemCount(50);
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.scrollToIndex(10);
    });

    // Default item height is 40, so index 10 top = 400
    expect(engine.scroll_offset()).toBe(400);
    expect(spy).toHaveBeenCalled();
  });

  it('scrollToIndexAligned calls engine.scroll_to_index_aligned and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItemCount(50);
      handle.setViewportHeight(400);
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.scrollToIndexAligned(10, 1); // Center align
    });

    expect(spy).toHaveBeenCalled();
    // Center: item_top(10) - viewport/2 + itemHeight/2 = 400 - 200 + 20 = 220
    expect(engine.scroll_offset()).toBe(220);
  });

  it('setAnchor calls engine.set_anchor and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setAnchor(5);
    });

    expect(engine.anchor()).toBe(5);
    expect(spy).toHaveBeenCalled();
  });

  it('clearAnchor calls engine.clear_anchor and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setAnchor(5);
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.clearAnchor();
    });

    expect(engine.anchor()).toBe(-1);
    expect(spy).toHaveBeenCalled();
  });

  it('reset calls engine.reset and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    // Set some state first
    act(() => {
      handle.setItemCount(100);
      handle.setViewportHeight(600);
      handle.setScrollOffset(200);
      handle.setAnchor(10);
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.reset();
    });

    expect(engine.item_count()).toBe(0);
    expect(engine.viewport_height()).toBe(0);
    expect(engine.scroll_offset()).toBe(0);
    expect(engine.anchor()).toBe(-1);
    expect(spy).toHaveBeenCalled();
  });

  it('getVirtualScrollState reads all scroll-level properties', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    const state = handle.getVirtualScrollState();
    expect(state).toEqual({
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

    act(() => {
      handle.setItemCount(10);
      handle.setViewportHeight(200);
    });

    const state2 = handle.getVirtualScrollState();
    expect(state2.itemCount).toBe(10);
    expect(state2.viewportHeight).toBe(200);
    expect(state2.totalHeight).toBe(400); // 10 * 40
    expect(state2.dataVersion).toBeGreaterThan(0);
  });

  it('getItemTop reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItemCount(10);
    });

    expect(handle.getItemTop(0)).toBe(0);
    expect(handle.getItemTop(5)).toBe(200); // 5 * 40
  });

  it('getItemHeight reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItemCount(10);
    });

    expect(handle.getItemHeight(0)).toBe(40); // default

    act(() => {
      handle.setItemHeight(0, 80);
    });

    expect(handle.getItemHeight(0)).toBe(80);
  });

  it('isIndexVisible reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItemCount(100);
      handle.setViewportHeight(200);
      handle.setScrollOffset(0);
    });

    expect(handle.isIndexVisible(0)).toBe(true);
    expect(handle.isIndexVisible(4)).toBe(true); // item at top=160, bottom=200
    expect(handle.isIndexVisible(5)).toBe(false); // item at top=200, exactly at viewport edge
  });

  it('getAnchorOffsetDelta reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useVirtualScrollEngine(engine));
    const handle = result.current!;

    expect(handle.getAnchorOffsetDelta()).toBe(0);
  });
});
