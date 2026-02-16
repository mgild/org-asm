/**
 * useTableEngine — Creates a TableHandle wrapping a Rust ITableEngine.
 *
 * The handle provides dispatch functions (setPage, toggleSort, setFilter, etc.)
 * that mutate the engine and notify subscribers. Per-row, per-cell, and table-level
 * hooks (useTableRow, useTableCell, useTableState) subscribe via the notifier.
 *
 * Usage:
 *   const engine = useMemo(() => new MyTableEngine(), []);
 *   const handle = useTableEngine(engine, wasmMemory);
 *   if (!handle) return null;
 *
 *   handle.toggleSort('price');
 *   handle.setPage(2);
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { ITableEngine } from '../core/interfaces';
import type { TableState, SortDirection } from '../core/types';

export interface TableHandle<E extends ITableEngine = ITableEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;
  readonly wasmMemory: WebAssembly.Memory | null;

  // Dispatch functions (mutate engine + notify)
  ingestPage(bytes: Uint8Array, totalRows: number): void;
  setPage(page: number): void;
  setPageSize(size: number): void;
  toggleSort(column: string): void;
  setSort(column: string, direction: SortDirection): void;
  setFilter(column: string, value: string): void;
  clearFilters(): void;
  toggleRow(rowIndex: number): void;
  selectAll(): void;
  deselectAll(): void;
  setEditValue(rowIndex: number, column: string, value: string): void;
  commitEdits(): string;
  discardEdits(): void;
  setGroupBy(column: string): void;
  clearGroupBy(): void;
  toggleGroup(groupIndex: number): void;
  reset(): void;

  // Reads (no notify)
  getTableState(): TableState;
  needsFetch(): boolean;
  queryDescriptor(): string;
  acknowledgeFetch(): void;
  getPageBuffer(): Uint8Array | null;
}

export function useTableEngine<E extends ITableEngine>(
  engine: E | null,
  wasmMemory?: WebAssembly.Memory | null,
): TableHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);
  const mem = wasmMemory ?? null;

  return useMemo(() => {
    if (engine === null) return null;

    return {
      engine,
      notifier,
      wasmMemory: mem,

      ingestPage(bytes: Uint8Array, totalRows: number): void {
        engine.ingest_page(bytes, totalRows);
        notifier.notify();
      },
      setPage(page: number): void {
        engine.set_page(page);
        notifier.notify();
      },
      setPageSize(size: number): void {
        engine.set_page_size(size);
        notifier.notify();
      },
      toggleSort(column: string): void {
        engine.toggle_sort(column);
        notifier.notify();
      },
      setSort(column: string, direction: SortDirection): void {
        engine.set_sort(column, direction);
        notifier.notify();
      },
      setFilter(column: string, value: string): void {
        engine.set_filter(column, value);
        notifier.notify();
      },
      clearFilters(): void {
        engine.clear_filters();
        notifier.notify();
      },
      toggleRow(rowIndex: number): void {
        engine.toggle_row(rowIndex);
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
      setEditValue(rowIndex: number, column: string, value: string): void {
        engine.set_edit_value(rowIndex, column, value);
        notifier.notify();
      },
      commitEdits(): string {
        const result = engine.commit_edits();
        notifier.notify();
        return result;
      },
      discardEdits(): void {
        engine.discard_edits();
        notifier.notify();
      },
      setGroupBy(column: string): void {
        engine.set_group_by(column);
        notifier.notify();
      },
      clearGroupBy(): void {
        engine.clear_group_by();
        notifier.notify();
      },
      toggleGroup(groupIndex: number): void {
        engine.toggle_group(groupIndex);
        notifier.notify();
      },
      reset(): void {
        engine.reset();
        notifier.notify();
      },

      getTableState(): TableState {
        return {
          page: engine.page(),
          pageSize: engine.page_size(),
          pageCount: engine.page_count(),
          totalRowCount: engine.total_row_count(),
          rowCount: engine.row_count(),
          sortColumn: engine.sort_column(),
          sortDirection: engine.sort_direction(),
          selectedCount: engine.selected_count(),
          allSelected: engine.all_selected(),
          hasEdits: engine.has_edits(),
          isEditable: engine.is_editable(),
          needsFetch: engine.needs_fetch(),
          groupByColumn: engine.group_by_column(),
          groupCount: engine.group_count(),
          dataVersion: engine.data_version(),
        };
      },
      needsFetch(): boolean {
        return engine.needs_fetch();
      },
      queryDescriptor(): string {
        return engine.query_descriptor();
      },
      acknowledgeFetch(): void {
        engine.acknowledge_fetch();
      },
      getPageBuffer(): Uint8Array | null {
        if (!mem) return null;
        const ptr = engine.page_ptr();
        const len = engine.page_len();
        if (len === 0) return null;
        return new Uint8Array(mem.buffer, ptr, len);
      },
    };
  }, [engine, notifier, mem]);
}
