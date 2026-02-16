import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelectionEngine } from '../useSelectionEngine';
import type { ISelectionEngine } from '../../core/interfaces';

function createMockEngine(): ISelectionEngine & {
  _items: string[];
  _selected: Set<string>;
  _focus: string;
  _anchor: string;
  _mode: number;
} {
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
    _items: items,
    _selected: selected,
    _focus: focus,
    _anchor: anchor,
    _mode: mode,

    set_mode(m: number) {
      mode = m;
      (this as ReturnType<typeof createMockEngine>)._mode = m;
      version++;
    },
    mode() { return mode; },

    set_items(json: string) {
      const parsed = JSON.parse(json) as string[];
      items.length = 0;
      for (const id of parsed) items.push(id);
      rebuildIndices();
      version++;
    },
    add_item(id: string, index: number) {
      items.splice(index, 0, id);
      rebuildIndices();
      version++;
    },
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
      items.length = 0;
      selected.clear();
      selectedOrder.length = 0;
      focus = '';
      (this as ReturnType<typeof createMockEngine>)._focus = '';
      anchor = '';
      (this as ReturnType<typeof createMockEngine>)._anchor = '';
      itemIndices.clear();
      version++;
    },
    item_count() { return items.length; },
    item_id(index: number) { return items[index] ?? ''; },
    item_index(id: string) { return itemIndices.get(id) ?? -1; },

    select(id: string) {
      if (mode === 0) {
        selected.clear();
        selectedOrder.length = 0;
      }
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
      if (selected.has(id)) {
        selected.delete(id);
        const idx = selectedOrder.indexOf(id);
        if (idx !== -1) selectedOrder.splice(idx, 1);
      } else {
        if (mode === 0) {
          selected.clear();
          selectedOrder.length = 0;
        }
        selected.add(id);
        selectedOrder.push(id);
      }
      version++;
    },
    select_range(fromId: string, toId: string) {
      const fromIdx = items.indexOf(fromId);
      const toIdx = items.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;
      const start = Math.min(fromIdx, toIdx);
      const end = Math.max(fromIdx, toIdx);
      for (let i = start; i <= end; i++) {
        const id = items[i];
        selected.add(id);
        if (!selectedOrder.includes(id)) selectedOrder.push(id);
      }
      version++;
    },
    select_all() {
      for (const id of items) {
        selected.add(id);
        if (!selectedOrder.includes(id)) selectedOrder.push(id);
      }
      version++;
    },
    deselect_all() {
      selected.clear();
      selectedOrder.length = 0;
      version++;
    },
    is_selected(id: string) { return selected.has(id); },
    selected_count() { return selected.size; },
    selected_id(index: number) { return selectedOrder[index] ?? ''; },

    set_focus(id: string) {
      focus = id;
      (this as ReturnType<typeof createMockEngine>)._focus = id;
      version++;
    },
    focus() { return focus; },
    is_focused(id: string) { return focus === id; },

    set_anchor(id: string) {
      anchor = id;
      (this as ReturnType<typeof createMockEngine>)._anchor = id;
      version++;
    },
    anchor() { return anchor; },
    clear_anchor() {
      anchor = '';
      (this as ReturnType<typeof createMockEngine>)._anchor = '';
      version++;
    },

    move_focus(direction: number) {
      const currentIdx = items.indexOf(focus);
      if (currentIdx === -1 && items.length > 0) {
        focus = items[0];
        (this as ReturnType<typeof createMockEngine>)._focus = focus;
      } else if (direction === 0 && currentIdx > 0) {
        focus = items[currentIdx - 1];
        (this as ReturnType<typeof createMockEngine>)._focus = focus;
      } else if (direction === 1 && currentIdx < items.length - 1) {
        focus = items[currentIdx + 1];
        (this as ReturnType<typeof createMockEngine>)._focus = focus;
      }
      version++;
    },
    activate_focus() {
      if (focus !== '') {
        if (mode === 0) {
          selected.clear();
          selectedOrder.length = 0;
        }
        selected.add(focus);
        if (!selectedOrder.includes(focus)) selectedOrder.push(focus);
      }
      version++;
    },

    data_version() { return version; },
    reset() {
      items.length = 0;
      selected.clear();
      selectedOrder.length = 0;
      focus = '';
      (this as ReturnType<typeof createMockEngine>)._focus = '';
      anchor = '';
      (this as ReturnType<typeof createMockEngine>)._anchor = '';
      mode = 0;
      (this as ReturnType<typeof createMockEngine>)._mode = 0;
      itemIndices.clear();
      version++;
    },
  };
}

describe('useSelectionEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useSelectionEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns SelectionHandle with all methods when engine is provided', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.notifier.subscribe).toBe('function');
    expect(typeof handle.notifier.notify).toBe('function');
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

  it('setMode calls engine.set_mode and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setMode(1);
    });

    expect(engine.mode()).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('setItems calls engine.set_items and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b', 'c']));
    });

    expect(engine.item_count()).toBe(3);
    expect(spy).toHaveBeenCalled();
  });

  it('addItem calls engine.add_item and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b']));
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.addItem('c', 1);
    });

    expect(engine.item_count()).toBe(3);
    expect(engine.item_id(1)).toBe('c');
    expect(spy).toHaveBeenCalled();
  });

  it('removeItem calls engine.remove_item and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b', 'c']));
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.removeItem('b');
    });

    expect(engine.item_count()).toBe(2);
    expect(spy).toHaveBeenCalled();
  });

  it('clearItems calls engine.clear_items and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b']));
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.clearItems();
    });

    expect(engine.item_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('select calls engine.select and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b']));
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.select('a');
    });

    expect(engine.is_selected('a')).toBe(true);
    expect(engine.selected_count()).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('deselect calls engine.deselect and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b']));
      handle.setMode(1);
      handle.select('a');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.deselect('a');
    });

    expect(engine.is_selected('a')).toBe(false);
    expect(engine.selected_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('toggle calls engine.toggle and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b']));
      handle.setMode(1);
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.toggle('a');
    });

    expect(engine.is_selected('a')).toBe(true);

    act(() => {
      handle.toggle('a');
    });

    expect(engine.is_selected('a')).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('selectRange calls engine.select_range and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b', 'c', 'd']));
      handle.setMode(2);
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.selectRange('a', 'c');
    });

    expect(engine.is_selected('a')).toBe(true);
    expect(engine.is_selected('b')).toBe(true);
    expect(engine.is_selected('c')).toBe(true);
    expect(engine.is_selected('d')).toBe(false);
    expect(engine.selected_count()).toBe(3);
    expect(spy).toHaveBeenCalled();
  });

  it('selectAll calls engine.select_all and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b', 'c']));
      handle.setMode(1);
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.selectAll();
    });

    expect(engine.selected_count()).toBe(3);
    expect(spy).toHaveBeenCalled();
  });

  it('deselectAll calls engine.deselect_all and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b']));
      handle.setMode(1);
      handle.selectAll();
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.deselectAll();
    });

    expect(engine.selected_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('setFocus calls engine.set_focus and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b']));
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setFocus('a');
    });

    expect(engine.focus()).toBe('a');
    expect(engine.is_focused('a')).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('setAnchor calls engine.set_anchor and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setAnchor('a');
    });

    expect(engine.anchor()).toBe('a');
    expect(spy).toHaveBeenCalled();
  });

  it('clearAnchor calls engine.clear_anchor and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setAnchor('a');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.clearAnchor();
    });

    expect(engine.anchor()).toBe('');
    expect(spy).toHaveBeenCalled();
  });

  it('moveFocus calls engine.move_focus and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b', 'c']));
      handle.setFocus('a');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.moveFocus(1); // down
    });

    expect(engine.focus()).toBe('b');
    expect(spy).toHaveBeenCalled();
  });

  it('activateFocus calls engine.activate_focus and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b']));
      handle.setFocus('b');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.activateFocus();
    });

    expect(engine.is_selected('b')).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('reset calls engine.reset and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b', 'c']));
      handle.setMode(1);
      handle.select('a');
      handle.setFocus('b');
      handle.setAnchor('a');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.reset();
    });

    expect(engine.item_count()).toBe(0);
    expect(engine.selected_count()).toBe(0);
    expect(engine.focus()).toBe('');
    expect(engine.anchor()).toBe('');
    expect(engine.mode()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('getSelectionState reads all selection-level properties', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    const state = handle.getSelectionState();
    expect(state).toEqual({
      mode: 0,
      itemCount: 0,
      selectedCount: 0,
      focusId: '',
      anchorId: '',
      dataVersion: 0,
    });

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b', 'c']));
      handle.setMode(1);
      handle.select('a');
      handle.setFocus('b');
      handle.setAnchor('a');
    });

    const state2 = handle.getSelectionState();
    expect(state2.mode).toBe(1);
    expect(state2.itemCount).toBe(3);
    expect(state2.selectedCount).toBe(1);
    expect(state2.focusId).toBe('b');
    expect(state2.anchorId).toBe('a');
    expect(state2.dataVersion).toBeGreaterThan(0);
  });

  it('isSelected reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b']));
      handle.select('a');
    });

    expect(handle.isSelected('a')).toBe(true);
    expect(handle.isSelected('b')).toBe(false);
  });

  it('isFocused reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b']));
      handle.setFocus('a');
    });

    expect(handle.isFocused('a')).toBe(true);
    expect(handle.isFocused('b')).toBe(false);
  });

  it('getSelectedIds iterates selected_id(0..selected_count())', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSelectionEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setItems(JSON.stringify(['a', 'b', 'c']));
      handle.setMode(1);
      handle.select('a');
      handle.select('c');
    });

    const ids = handle.getSelectedIds();
    expect(ids).toEqual(['a', 'c']);
    expect(ids.length).toBe(2);
  });
});
