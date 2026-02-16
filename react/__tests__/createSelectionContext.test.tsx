import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createSelectionContext } from '../createSelectionContext';
import type { ISelectionEngine } from '../../core/interfaces';

function createMockEngine(): ISelectionEngine {
  const items: string[] = [];
  const itemIndices = new Map<string, number>();
  const selected = new Set<string>();
  const selectedOrder: string[] = [];
  let focus = '';
  let anchor = '';
  let mode = 0;
  let version = 0;

  function rebuildIndices() {
    itemIndices.clear();
    for (let i = 0; i < items.length; i++) {
      itemIndices.set(items[i], i);
    }
  }

  return {
    set_mode(m: number) { mode = m; version++; },
    mode() { return mode; },
    set_items(json: string) {
      const parsed = JSON.parse(json) as string[];
      items.length = 0;
      for (const id of parsed) items.push(id);
      rebuildIndices();
      version++;
    },
    add_item(id: string, index: number) { items.splice(index, 0, id); rebuildIndices(); version++; },
    remove_item(id: string) {
      const idx = items.indexOf(id);
      if (idx !== -1) items.splice(idx, 1);
      selected.delete(id);
      const orderIdx = selectedOrder.indexOf(id);
      if (orderIdx !== -1) selectedOrder.splice(orderIdx, 1);
      rebuildIndices();
      version++;
    },
    clear_items() {
      items.length = 0; selected.clear(); selectedOrder.length = 0;
      focus = ''; anchor = ''; itemIndices.clear(); version++;
    },
    item_count() { return items.length; },
    item_id(index: number) { return items[index] ?? ''; },
    item_index(id: string) { return itemIndices.get(id) ?? -1; },
    select(id: string) {
      if (mode === 0) { selected.clear(); selectedOrder.length = 0; }
      selected.add(id);
      if (!selectedOrder.includes(id)) selectedOrder.push(id);
      version++;
    },
    deselect(id: string) {
      selected.delete(id);
      const idx = selectedOrder.indexOf(id);
      if (idx !== -1) selectedOrder.splice(idx, 1);
      version++;
    },
    toggle(id: string) {
      if (selected.has(id)) { selected.delete(id); const idx = selectedOrder.indexOf(id); if (idx !== -1) selectedOrder.splice(idx, 1); }
      else { if (mode === 0) { selected.clear(); selectedOrder.length = 0; } selected.add(id); selectedOrder.push(id); }
      version++;
    },
    select_range(fromId: string, toId: string) {
      const fromIdx = items.indexOf(fromId);
      const toIdx = items.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;
      const start = Math.min(fromIdx, toIdx);
      const end = Math.max(fromIdx, toIdx);
      for (let i = start; i <= end; i++) { selected.add(items[i]); if (!selectedOrder.includes(items[i])) selectedOrder.push(items[i]); }
      version++;
    },
    select_all() { for (const id of items) { selected.add(id); if (!selectedOrder.includes(id)) selectedOrder.push(id); } version++; },
    deselect_all() { selected.clear(); selectedOrder.length = 0; version++; },
    is_selected(id: string) { return selected.has(id); },
    selected_count() { return selected.size; },
    selected_id(index: number) { return selectedOrder[index] ?? ''; },
    set_focus(id: string) { focus = id; version++; },
    focus() { return focus; },
    is_focused(id: string) { return focus === id; },
    set_anchor(id: string) { anchor = id; version++; },
    anchor() { return anchor; },
    clear_anchor() { anchor = ''; version++; },
    move_focus(direction: number) {
      const currentIdx = items.indexOf(focus);
      if (currentIdx === -1 && items.length > 0) { focus = items[0]; }
      else if (direction === 0 && currentIdx > 0) { focus = items[currentIdx - 1]; }
      else if (direction === 1 && currentIdx < items.length - 1) { focus = items[currentIdx + 1]; }
      version++;
    },
    activate_focus() {
      if (focus !== '') { if (mode === 0) { selected.clear(); selectedOrder.length = 0; } selected.add(focus); if (!selectedOrder.includes(focus)) selectedOrder.push(focus); }
      version++;
    },
    data_version() { return version; },
    reset() {
      items.length = 0; selected.clear(); selectedOrder.length = 0;
      focus = ''; anchor = ''; mode = 0; itemIndices.clear(); version++;
    },
  };
}

describe('createSelectionContext', () => {
  it('useSelection returns handle from provider', () => {
    const ctx = createSelectionContext<ISelectionEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.SelectionProvider engine={engine}>
        {children}
      </ctx.SelectionProvider>
    );

    const { result } = renderHook(() => ctx.useSelection(), { wrapper });
    const handle = result.current;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.setMode).toBe('function');
    expect(typeof handle.setItems).toBe('function');
    expect(typeof handle.addItem).toBe('function');
    expect(typeof handle.removeItem).toBe('function');
    expect(typeof handle.clearItems).toBe('function');
    expect(typeof handle.select).toBe('function');
    expect(typeof handle.deselect).toBe('function');
    expect(typeof handle.toggle).toBe('function');
    expect(typeof handle.selectRange).toBe('function');
    expect(typeof handle.selectAll).toBe('function');
    expect(typeof handle.deselectAll).toBe('function');
    expect(typeof handle.setFocus).toBe('function');
    expect(typeof handle.setAnchor).toBe('function');
    expect(typeof handle.clearAnchor).toBe('function');
    expect(typeof handle.moveFocus).toBe('function');
    expect(typeof handle.activateFocus).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getSelectionState).toBe('function');
    expect(typeof handle.isSelected).toBe('function');
    expect(typeof handle.isFocused).toBe('function');
    expect(typeof handle.getSelectedIds).toBe('function');
  });

  it('useSelectionItem returns item state from provider', () => {
    const ctx = createSelectionContext<ISelectionEngine>();
    const engine = createMockEngine();
    engine.set_items(JSON.stringify(['item-1', 'item-2', 'item-3']));
    engine.select('item-2');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.SelectionProvider engine={engine}>
        {children}
      </ctx.SelectionProvider>
    );

    const { result } = renderHook(() => ctx.useSelectionItem('item-2'), { wrapper });

    expect(result.current.id).toBe('item-2');
    expect(result.current.isSelected).toBe(true);
    expect(result.current.index).toBe(1);
  });

  it('useSelectionStatus returns selection state from provider', () => {
    const ctx = createSelectionContext<ISelectionEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.SelectionProvider engine={engine}>
        {children}
      </ctx.SelectionProvider>
    );

    const { result } = renderHook(() => ctx.useSelectionStatus(), { wrapper });

    expect(result.current).toEqual({
      mode: 0,
      itemCount: 0,
      selectedCount: 0,
      focusId: '',
      anchorId: '',
      dataVersion: 0,
    });
  });

  it('useSelection throws outside provider', () => {
    const ctx = createSelectionContext<ISelectionEngine>();

    expect(() => {
      renderHook(() => ctx.useSelection());
    }).toThrow('useSelection must be used within a SelectionProvider');
  });

  it('useSelectionItem returns empty state outside provider (null handle)', () => {
    const ctx = createSelectionContext<ISelectionEngine>();

    const { result } = renderHook(() => ctx.useSelectionItem('any-id'));

    expect(result.current).toEqual({
      id: '',
      isSelected: false,
      isFocused: false,
      index: -1,
    });
  });

  it('useSelectionStatus returns empty state outside provider (null handle)', () => {
    const ctx = createSelectionContext<ISelectionEngine>();

    const { result } = renderHook(() => ctx.useSelectionStatus());

    expect(result.current).toEqual({
      mode: 0,
      itemCount: 0,
      selectedCount: 0,
      focusId: '',
      anchorId: '',
      dataVersion: 0,
    });
  });

  it('children render correctly', () => {
    const ctx = createSelectionContext<ISelectionEngine>();
    const engine = createMockEngine();

    const { container } = render(
      <ctx.SelectionProvider engine={engine}>
        <div data-testid="child">Hello from child</div>
      </ctx.SelectionProvider>,
    );

    expect(container.textContent).toBe('Hello from child');
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('SelectionProvider works with null engine', () => {
    const ctx = createSelectionContext<ISelectionEngine>();

    const { result } = renderHook(() => ctx.useSelectionItem('any-id'), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.SelectionProvider engine={null}>
          {children}
        </ctx.SelectionProvider>
      ),
    });

    expect(result.current).toEqual({
      id: '',
      isSelected: false,
      isFocused: false,
      index: -1,
    });
  });

  it('mutations via useSelection propagate to useSelectionItem and useSelectionStatus', () => {
    const ctx = createSelectionContext<ISelectionEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.SelectionProvider engine={engine}>
        {children}
      </ctx.SelectionProvider>
    );

    const { result } = renderHook(
      () => ({
        selection: ctx.useSelection(),
        item1: ctx.useSelectionItem('item-1'),
        status: ctx.useSelectionStatus(),
      }),
      { wrapper },
    );

    expect(result.current.item1.isSelected).toBe(false);
    expect(result.current.status.itemCount).toBe(0);
    expect(result.current.status.selectedCount).toBe(0);

    act(() => {
      result.current.selection.setItems(JSON.stringify(['item-1', 'item-2', 'item-3']));
    });

    expect(result.current.status.itemCount).toBe(3);
    expect(result.current.item1.index).toBe(0);

    act(() => {
      result.current.selection.select('item-1');
    });

    expect(result.current.item1.isSelected).toBe(true);
    expect(result.current.status.selectedCount).toBe(1);

    act(() => {
      result.current.selection.setFocus('item-1');
    });

    expect(result.current.item1.isFocused).toBe(true);
    expect(result.current.status.focusId).toBe('item-1');
  });
});
