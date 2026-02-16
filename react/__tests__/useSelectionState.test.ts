import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelectionState } from '../useSelectionState';
import { createNotifier } from '../useWasmState';
import type { ISelectionEngine } from '../../core/interfaces';
import type { SelectionHandle } from '../useSelectionEngine';
import type { SelectionState } from '../../core/types';

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

function createHandle(engine: ISelectionEngine): SelectionHandle {
  const notifier = createNotifier();
  return {
    engine,
    notifier,
    setMode(mode: number): void { engine.set_mode(mode); notifier.notify(); },
    setItems(json: string): void { engine.set_items(json); notifier.notify(); },
    addItem(id: string, index: number): void { engine.add_item(id, index); notifier.notify(); },
    removeItem(id: string): void { engine.remove_item(id); notifier.notify(); },
    clearItems(): void { engine.clear_items(); notifier.notify(); },
    select(id: string): void { engine.select(id); notifier.notify(); },
    deselect(id: string): void { engine.deselect(id); notifier.notify(); },
    toggle(id: string): void { engine.toggle(id); notifier.notify(); },
    selectRange(fromId: string, toId: string): void { engine.select_range(fromId, toId); notifier.notify(); },
    selectAll(): void { engine.select_all(); notifier.notify(); },
    deselectAll(): void { engine.deselect_all(); notifier.notify(); },
    setFocus(id: string): void { engine.set_focus(id); notifier.notify(); },
    setAnchor(id: string): void { engine.set_anchor(id); notifier.notify(); },
    clearAnchor(): void { engine.clear_anchor(); notifier.notify(); },
    moveFocus(direction: number): void { engine.move_focus(direction); notifier.notify(); },
    activateFocus(): void { engine.activate_focus(); notifier.notify(); },
    reset(): void { engine.reset(); notifier.notify(); },
    getSelectionState(): SelectionState {
      return {
        mode: engine.mode(),
        itemCount: engine.item_count(),
        selectedCount: engine.selected_count(),
        focusId: engine.focus(),
        anchorId: engine.anchor(),
        dataVersion: engine.data_version(),
      };
    },
    isSelected(id: string): boolean { return engine.is_selected(id); },
    isFocused(id: string): boolean { return engine.is_focused(id); },
    getSelectedIds(): string[] {
      const count = engine.selected_count();
      const ids: string[] = [];
      for (let i = 0; i < count; i++) { ids.push(engine.selected_id(i)); }
      return ids;
    },
  };
}

describe('useSelectionState', () => {
  it('returns empty SelectionState when handle is null', () => {
    const { result } = renderHook(() => useSelectionState(null));
    expect(result.current).toEqual({
      mode: 0,
      itemCount: 0,
      selectedCount: 0,
      focusId: '',
      anchorId: '',
      dataVersion: 0,
    });
  });

  it('returns correct selection state', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useSelectionState(handle));

    expect(result.current).toEqual({
      mode: 0,
      itemCount: 0,
      selectedCount: 0,
      focusId: '',
      anchorId: '',
      dataVersion: 0,
    });
  });

  it('reflects selectedCount after select', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    engine.set_items(JSON.stringify(['a', 'b', 'c']));

    const { result } = renderHook(() => useSelectionState(handle));

    act(() => {
      handle.select('a');
    });

    expect(result.current.selectedCount).toBe(1);
    expect(result.current.dataVersion).toBeGreaterThan(0);
  });

  it('reflects mode after setMode', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useSelectionState(handle));
    expect(result.current.mode).toBe(0);

    act(() => {
      handle.setMode(1);
    });

    expect(result.current.mode).toBe(1);
  });

  it('reflects itemCount after setItems', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useSelectionState(handle));
    expect(result.current.itemCount).toBe(0);

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b', 'c']));
    });

    expect(result.current.itemCount).toBe(3);
  });

  it('reflects focusId after setFocus', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    engine.set_items(JSON.stringify(['a', 'b']));

    const { result } = renderHook(() => useSelectionState(handle));
    expect(result.current.focusId).toBe('');

    act(() => {
      handle.setFocus('a');
    });

    expect(result.current.focusId).toBe('a');
  });

  it('reflects anchorId after setAnchor', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useSelectionState(handle));
    expect(result.current.anchorId).toBe('');

    act(() => {
      handle.setAnchor('b');
    });

    expect(result.current.anchorId).toBe('b');
  });

  it('updates on notify', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    engine.set_items(JSON.stringify(['a', 'b', 'c']));

    const { result } = renderHook(() => useSelectionState(handle));
    const initialVersion = result.current.dataVersion;

    act(() => {
      handle.select('a');
    });

    expect(result.current.dataVersion).toBeGreaterThan(initialVersion);

    act(() => {
      handle.reset();
    });

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.focusId).toBe('');
    expect(result.current.anchorId).toBe('');
    expect(result.current.mode).toBe(0);
  });
});
