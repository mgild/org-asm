import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createVirtualScrollContext } from '../createVirtualScrollContext';
import type { IVirtualScrollEngine } from '../../core/interfaces';

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

describe('createVirtualScrollContext', () => {
  it('useVirtualScroll returns handle from provider', () => {
    const ctx = createVirtualScrollContext<IVirtualScrollEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.VirtualScrollProvider engine={engine}>
        {children}
      </ctx.VirtualScrollProvider>
    );

    const { result } = renderHook(() => ctx.useVirtualScroll(), { wrapper });
    const handle = result.current;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
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

  it('useVirtualScrollItem returns item state from provider', () => {
    const ctx = createVirtualScrollContext<IVirtualScrollEngine>();
    const engine = createMockEngine();
    engine.set_item_count(10);
    engine.set_viewport_height(400);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.VirtualScrollProvider engine={engine}>
        {children}
      </ctx.VirtualScrollProvider>
    );

    const { result } = renderHook(() => ctx.useVirtualScrollItem(2), { wrapper });

    expect(result.current.index).toBe(2);
    expect(result.current.top).toBe(80); // 2 * 40
    expect(result.current.height).toBe(40);
    expect(result.current.isVisible).toBe(true);
  });

  it('useVirtualScrollStatus returns scroll state from provider', () => {
    const ctx = createVirtualScrollContext<IVirtualScrollEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.VirtualScrollProvider engine={engine}>
        {children}
      </ctx.VirtualScrollProvider>
    );

    const { result } = renderHook(() => ctx.useVirtualScrollStatus(), { wrapper });

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

  it('useVirtualScroll throws outside provider', () => {
    const ctx = createVirtualScrollContext<IVirtualScrollEngine>();

    expect(() => {
      renderHook(() => ctx.useVirtualScroll());
    }).toThrow('useVirtualScroll must be used within a VirtualScrollProvider');
  });

  it('useVirtualScrollItem returns empty state outside provider (null handle)', () => {
    const ctx = createVirtualScrollContext<IVirtualScrollEngine>();

    const { result } = renderHook(() => ctx.useVirtualScrollItem(0));

    expect(result.current).toEqual({
      index: 0,
      top: 0,
      height: 0,
      isVisible: false,
    });
  });

  it('useVirtualScrollStatus returns empty state outside provider (null handle)', () => {
    const ctx = createVirtualScrollContext<IVirtualScrollEngine>();

    const { result } = renderHook(() => ctx.useVirtualScrollStatus());

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

  it('children render correctly', () => {
    const ctx = createVirtualScrollContext<IVirtualScrollEngine>();
    const engine = createMockEngine();

    const { container } = render(
      <ctx.VirtualScrollProvider engine={engine}>
        <div data-testid="child">Hello from child</div>
      </ctx.VirtualScrollProvider>,
    );

    expect(container.textContent).toBe('Hello from child');
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('VirtualScrollProvider works with null engine', () => {
    const ctx = createVirtualScrollContext<IVirtualScrollEngine>();

    const { result } = renderHook(() => ctx.useVirtualScrollItem(0), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.VirtualScrollProvider engine={null}>
          {children}
        </ctx.VirtualScrollProvider>
      ),
    });

    expect(result.current).toEqual({
      index: 0,
      top: 0,
      height: 0,
      isVisible: false,
    });
  });

  it('mutations via useVirtualScroll propagate to useVirtualScrollItem and useVirtualScrollStatus', () => {
    const ctx = createVirtualScrollContext<IVirtualScrollEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.VirtualScrollProvider engine={engine}>
        {children}
      </ctx.VirtualScrollProvider>
    );

    const { result } = renderHook(
      () => ({
        scroll: ctx.useVirtualScroll(),
        item0: ctx.useVirtualScrollItem(0),
        status: ctx.useVirtualScrollStatus(),
      }),
      { wrapper },
    );

    expect(result.current.item0.isVisible).toBe(false);
    expect(result.current.status.itemCount).toBe(0);
    expect(result.current.status.viewportHeight).toBe(0);

    act(() => {
      result.current.scroll.setItemCount(10);
      result.current.scroll.setViewportHeight(400);
    });

    expect(result.current.item0.isVisible).toBe(true);
    expect(result.current.item0.top).toBe(0);
    expect(result.current.item0.height).toBe(40);
    expect(result.current.status.itemCount).toBe(10);
    expect(result.current.status.viewportHeight).toBe(400);
    expect(result.current.status.totalHeight).toBe(400); // 10 * 40

    act(() => {
      result.current.scroll.setScrollOffset(200);
    });

    expect(result.current.status.scrollOffset).toBe(200);
  });
});
