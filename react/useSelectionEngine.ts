/**
 * useSelectionEngine — Creates a SelectionHandle wrapping a Rust ISelectionEngine.
 *
 * The handle provides dispatch functions (select, deselect, toggle, etc.)
 * that mutate the engine and notify subscribers. Per-item and selection-level
 * hooks (useSelectionItem, useSelectionState) subscribe via the notifier.
 *
 * Usage:
 *   const engine = useMemo(() => new MySelectionEngine(), []);
 *   const handle = useSelectionEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.select('item-1');
 *   handle.toggle('item-2');
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { ISelectionEngine } from '../core/interfaces';
import type { SelectionState } from '../core/types';

export interface SelectionHandle<E extends ISelectionEngine = ISelectionEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;

  // Dispatch functions (mutate engine + notify)
  setMode(mode: number): void;
  setItems(json: string): void;
  addItem(id: string, index: number): void;
  removeItem(id: string): void;
  clearItems(): void;
  select(id: string): void;
  deselect(id: string): void;
  toggle(id: string): void;
  selectRange(fromId: string, toId: string): void;
  selectAll(): void;
  deselectAll(): void;
  setFocus(id: string): void;
  setAnchor(id: string): void;
  clearAnchor(): void;
  moveFocus(direction: number): void;
  activateFocus(): void;
  reset(): void;

  // Reads (no notify)
  getSelectionState(): SelectionState;
  isSelected(id: string): boolean;
  isFocused(id: string): boolean;
  getSelectedIds(): string[];
}

export function useSelectionEngine<E extends ISelectionEngine>(
  engine: E | null,
): SelectionHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

    return {
      engine,
      notifier,

      setMode(mode: number): void {
        engine.set_mode(mode);
        notifier.notify();
      },
      setItems(json: string): void {
        engine.set_items(json);
        notifier.notify();
      },
      addItem(id: string, index: number): void {
        engine.add_item(id, index);
        notifier.notify();
      },
      removeItem(id: string): void {
        engine.remove_item(id);
        notifier.notify();
      },
      clearItems(): void {
        engine.clear_items();
        notifier.notify();
      },
      select(id: string): void {
        engine.select(id);
        notifier.notify();
      },
      deselect(id: string): void {
        engine.deselect(id);
        notifier.notify();
      },
      toggle(id: string): void {
        engine.toggle(id);
        notifier.notify();
      },
      selectRange(fromId: string, toId: string): void {
        engine.select_range(fromId, toId);
        notifier.notify();
      },
      selectAll(): void {
        engine.select_all();
        notifier.notify();
      },
      deselectAll(): void {
        engine.deselect_all();
        notifier.notify();
      },
      setFocus(id: string): void {
        engine.set_focus(id);
        notifier.notify();
      },
      setAnchor(id: string): void {
        engine.set_anchor(id);
        notifier.notify();
      },
      clearAnchor(): void {
        engine.clear_anchor();
        notifier.notify();
      },
      moveFocus(direction: number): void {
        engine.move_focus(direction);
        notifier.notify();
      },
      activateFocus(): void {
        engine.activate_focus();
        notifier.notify();
      },
      reset(): void {
        engine.reset();
        notifier.notify();
      },

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
      isSelected(id: string): boolean {
        return engine.is_selected(id);
      },
      isFocused(id: string): boolean {
        return engine.is_focused(id);
      },
      getSelectedIds(): string[] {
        const count = engine.selected_count();
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
          ids.push(engine.selected_id(i));
        }
        return ids;
      },
    };
  }, [engine, notifier]);
}
