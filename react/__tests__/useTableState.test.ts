import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTableState } from '../useTableState';
import { createNotifier } from '../useWasmState';
import type { ITableEngine } from '../../core/interfaces';
import type { TableHandle } from '../useTableEngine';
import type { TableState } from '../../core/types';
import { SortDirection } from '../../core/types';

function createMockTableEngine(): ITableEngine & {
  _selected: Set<number>;
  _edits: Map<string, string>;
  _editErrors: Map<string, string>;
  _filters: Map<string, string>;
  _expandedGroups: Set<number>;
  _needsFetch: boolean;
  _editable: boolean;
  _totalRows: number;
  _page: number;
  _pageSize: number;
  _sortColumn: string;
  _sortDirection: number;
  _groupBy: string;
  _pageData: Uint8Array;
} {
  let page = 0;
  let pageSize = 25;
  let totalRows = 0;
  let version = 0;
  let pageData = new Uint8Array(0);
  let sortColumn = '';
  let sortDirection = 0;
  const filters = new Map<string, string>();
  const selected = new Set<number>();
  const edits = new Map<string, string>();
  const editErrors = new Map<string, string>();
  let groupBy = '';
  let needsFetch = false;
  let editable = true;
  const expandedGroups = new Set<number>();

  return {
    page_ptr() { return 0; },
    page_len() { return pageData.length; },
    row_count() { return totalRows > 0 ? Math.min(pageSize, totalRows - page * pageSize) : 0; },
    total_row_count() { return totalRows; },
    ingest_page(bytes: Uint8Array, total: number) { pageData = bytes; totalRows = total; needsFetch = false; version++; },
    page() { return page; },
    page_size() { return pageSize; },
    page_count() { return totalRows > 0 ? Math.ceil(totalRows / pageSize) : 0; },
    set_page(p: number) { page = p; needsFetch = true; version++; },
    set_page_size(s: number) { pageSize = s; page = 0; needsFetch = true; version++; },
    sort_column() { return sortColumn; },
    sort_direction() { return sortDirection; },
    set_sort(col: string, dir: number) { sortColumn = col; sortDirection = dir; needsFetch = true; version++; },
    toggle_sort(col: string) {
      if (sortColumn !== col) { sortColumn = col; sortDirection = 1; }
      else if (sortDirection === 1) { sortDirection = 2; }
      else { sortColumn = ''; sortDirection = 0; }
      needsFetch = true; version++;
    },
    filter_value(col: string) { return filters.get(col) ?? ''; },
    set_filter(col: string, val: string) { if (val) filters.set(col, val); else filters.delete(col); page = 0; needsFetch = true; version++; },
    clear_filters() { filters.clear(); page = 0; needsFetch = true; version++; },
    is_row_selected(idx: number) { return selected.has(idx); },
    select_row(idx: number) { selected.add(idx); version++; },
    deselect_row(idx: number) { selected.delete(idx); version++; },
    toggle_row(idx: number) { if (selected.has(idx)) selected.delete(idx); else selected.add(idx); version++; },
    select_all() { const count = totalRows > 0 ? Math.min(pageSize, totalRows - page * pageSize) : 0; for (let i = 0; i < count; i++) selected.add(i); version++; },
    deselect_all() { selected.clear(); version++; },
    selected_count() { return selected.size; },
    all_selected() { const count = totalRows > 0 ? Math.min(pageSize, totalRows - page * pageSize) : 0; return count > 0 && selected.size >= count; },
    is_editable() { return editable; },
    edit_value(row: number, col: string) { return edits.get(`${row}:${col}`) ?? ''; },
    set_edit_value(row: number, col: string, val: string) { edits.set(`${row}:${col}`, val); version++; },
    cell_error(row: number, col: string) { return editErrors.get(`${row}:${col}`) ?? ''; },
    is_cell_dirty(row: number, col: string) { return edits.has(`${row}:${col}`); },
    has_edits() { return edits.size > 0; },
    commit_edits() { const result = JSON.stringify(Object.fromEntries(edits)); edits.clear(); version++; return result; },
    discard_edits() { edits.clear(); editErrors.clear(); version++; },
    group_by_column() { return groupBy; },
    set_group_by(col: string) { groupBy = col; needsFetch = true; version++; },
    clear_group_by() { groupBy = ''; needsFetch = true; version++; },
    group_count() { return groupBy ? 1 : 0; },
    group_label(idx: number) { return groupBy ? `Group ${idx}` : ''; },
    group_row_count(idx: number) { return JSON.stringify({ count: 0 }); },
    is_group_expanded(idx: number) { return expandedGroups.has(idx); },
    toggle_group(idx: number) { if (expandedGroups.has(idx)) expandedGroups.delete(idx); else expandedGroups.add(idx); version++; },
    needs_fetch() { return needsFetch; },
    acknowledge_fetch() { needsFetch = false; },
    query_descriptor() { return JSON.stringify({ page, page_size: pageSize, sort_column: sortColumn, sort_direction: sortDirection, filters: Object.fromEntries(filters), group_by: groupBy }); },
    data_version() { return version; },
    reset() { page = 0; pageSize = 25; totalRows = 0; pageData = new Uint8Array(0); sortColumn = ''; sortDirection = 0; filters.clear(); selected.clear(); edits.clear(); editErrors.clear(); groupBy = ''; expandedGroups.clear(); needsFetch = false; version++; },

    _selected: selected,
    _edits: edits,
    _editErrors: editErrors,
    _filters: filters,
    _expandedGroups: expandedGroups,
    get _needsFetch() { return needsFetch; },
    set _needsFetch(v: boolean) { needsFetch = v; },
    get _editable() { return editable; },
    set _editable(v: boolean) { editable = v; },
    get _totalRows() { return totalRows; },
    set _totalRows(v: number) { totalRows = v; },
    get _page() { return page; },
    set _page(v: number) { page = v; },
    get _pageSize() { return pageSize; },
    set _pageSize(v: number) { pageSize = v; },
    get _sortColumn() { return sortColumn; },
    set _sortColumn(v: string) { sortColumn = v; },
    get _sortDirection() { return sortDirection; },
    set _sortDirection(v: number) { sortDirection = v; },
    get _groupBy() { return groupBy; },
    set _groupBy(v: string) { groupBy = v; },
    get _pageData() { return pageData; },
    set _pageData(v: Uint8Array) { pageData = v; },
  };
}

function createTableHandle(engine: ITableEngine): TableHandle {
  const notifier = createNotifier();
  return {
    engine,
    notifier,
    wasmMemory: null,
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
    setSort(column: string, direction: number): void {
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
      return null;
    },
  };
}

describe('useTableState', () => {
  it('returns empty TableState when handle is null', () => {
    const { result } = renderHook(() => useTableState(null));
    expect(result.current).toEqual({
      page: 0,
      pageSize: 0,
      pageCount: 0,
      totalRowCount: 0,
      rowCount: 0,
      sortColumn: '',
      sortDirection: SortDirection.None,
      selectedCount: 0,
      allSelected: false,
      hasEdits: false,
      isEditable: false,
      needsFetch: false,
      groupByColumn: '',
      groupCount: 0,
      dataVersion: 0,
    });
  });

  it('returns correct table state (all fields)', () => {
    const engine = createMockTableEngine();
    engine._totalRows = 100;
    engine._editable = true;
    const handle = createTableHandle(engine);

    const { result } = renderHook(() => useTableState(handle));

    expect(result.current).toEqual({
      page: 0,
      pageSize: 25,
      pageCount: 4,
      totalRowCount: 100,
      rowCount: 25,
      sortColumn: '',
      sortDirection: SortDirection.None,
      selectedCount: 0,
      allSelected: false,
      hasEdits: false,
      isEditable: true,
      needsFetch: false,
      groupByColumn: '',
      groupCount: 0,
      dataVersion: 0,
    });
  });

  it('reflects page change', () => {
    const engine = createMockTableEngine();
    engine._totalRows = 100;
    const handle = createTableHandle(engine);

    const { result } = renderHook(() => useTableState(handle));
    expect(result.current.page).toBe(0);

    act(() => {
      handle.setPage(2);
    });

    expect(result.current.page).toBe(2);
    expect(result.current.needsFetch).toBe(true);
    expect(result.current.dataVersion).toBeGreaterThan(0);
  });

  it('reflects sort change', () => {
    const engine = createMockTableEngine();
    const handle = createTableHandle(engine);

    const { result } = renderHook(() => useTableState(handle));
    expect(result.current.sortColumn).toBe('');
    expect(result.current.sortDirection).toBe(SortDirection.None);

    act(() => {
      handle.toggleSort('price');
    });

    expect(result.current.sortColumn).toBe('price');
    expect(result.current.sortDirection).toBe(SortDirection.Asc);
    expect(result.current.needsFetch).toBe(true);
  });

  it('reflects filter change', () => {
    const engine = createMockTableEngine();
    engine._totalRows = 100;
    const handle = createTableHandle(engine);

    const { result } = renderHook(() => useTableState(handle));
    expect(result.current.needsFetch).toBe(false);

    act(() => {
      handle.setFilter('status', 'active');
    });

    expect(result.current.page).toBe(0);
    expect(result.current.needsFetch).toBe(true);
    expect(result.current.dataVersion).toBeGreaterThan(0);
  });

  it('updates on notify', () => {
    const engine = createMockTableEngine();
    engine._totalRows = 100;
    const handle = createTableHandle(engine);

    const { result } = renderHook(() => useTableState(handle));
    const initialVersion = result.current.dataVersion;

    act(() => {
      handle.setPage(1);
    });

    expect(result.current.dataVersion).toBeGreaterThan(initialVersion);

    act(() => {
      handle.reset();
    });

    expect(result.current.page).toBe(0);
    expect(result.current.sortColumn).toBe('');
    expect(result.current.needsFetch).toBe(false);
  });
});
