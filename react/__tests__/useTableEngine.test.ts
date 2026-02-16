import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTableEngine } from '../useTableEngine';
import { createNotifier } from '../useWasmState';
import type { ITableEngine } from '../../core/interfaces';
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

    // Exposed internals for test manipulation
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

describe('useTableEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useTableEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns TableHandle with all methods when engine is provided', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(handle.wasmMemory).toBe(null);
    expect(typeof handle.notifier.subscribe).toBe('function');
    expect(typeof handle.notifier.notify).toBe('function');
    expect(typeof handle.ingestPage).toBe('function');
    expect(typeof handle.setPage).toBe('function');
    expect(typeof handle.setPageSize).toBe('function');
    expect(typeof handle.toggleSort).toBe('function');
    expect(typeof handle.setSort).toBe('function');
    expect(typeof handle.setFilter).toBe('function');
    expect(typeof handle.clearFilters).toBe('function');
    expect(typeof handle.toggleRow).toBe('function');
    expect(typeof handle.selectAll).toBe('function');
    expect(typeof handle.deselectAll).toBe('function');
    expect(typeof handle.setEditValue).toBe('function');
    expect(typeof handle.commitEdits).toBe('function');
    expect(typeof handle.discardEdits).toBe('function');
    expect(typeof handle.setGroupBy).toBe('function');
    expect(typeof handle.clearGroupBy).toBe('function');
    expect(typeof handle.toggleGroup).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getTableState).toBe('function');
    expect(typeof handle.needsFetch).toBe('function');
    expect(typeof handle.queryDescriptor).toBe('function');
    expect(typeof handle.acknowledgeFetch).toBe('function');
    expect(typeof handle.getPageBuffer).toBe('function');
  });

  it('ingestPage calls engine.ingest_page and notifies', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    const bytes = new Uint8Array([1, 2, 3]);
    act(() => {
      handle.ingestPage(bytes, 100);
    });

    expect(engine.total_row_count()).toBe(100);
    expect(spy).toHaveBeenCalled();
  });

  it('setPage calls engine.set_page and notifies', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setPage(3);
    });

    expect(engine.page()).toBe(3);
    expect(engine.needs_fetch()).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('setPageSize calls engine.set_page_size and notifies', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setPageSize(50);
    });

    expect(engine.page_size()).toBe(50);
    expect(engine.page()).toBe(0);
    expect(engine.needs_fetch()).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('toggleSort calls engine.toggle_sort and notifies', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.toggleSort('price');
    });

    expect(engine.sort_column()).toBe('price');
    expect(engine.sort_direction()).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('setSort calls engine.set_sort and notifies', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setSort('name', SortDirection.Desc);
    });

    expect(engine.sort_column()).toBe('name');
    expect(engine.sort_direction()).toBe(SortDirection.Desc);
    expect(spy).toHaveBeenCalled();
  });

  it('setFilter calls engine.set_filter and notifies', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setFilter('status', 'active');
    });

    expect(engine.filter_value('status')).toBe('active');
    expect(engine.needs_fetch()).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('clearFilters calls engine.clear_filters and notifies', () => {
    const engine = createMockTableEngine();
    engine._filters.set('status', 'active');
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.clearFilters();
    });

    expect(engine.filter_value('status')).toBe('');
    expect(spy).toHaveBeenCalled();
  });

  it('toggleRow calls engine.toggle_row and notifies', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.toggleRow(5);
    });

    expect(engine.is_row_selected(5)).toBe(true);
    expect(spy).toHaveBeenCalled();

    act(() => {
      handle.toggleRow(5);
    });

    expect(engine.is_row_selected(5)).toBe(false);
  });

  it('selectAll calls engine.select_all and notifies', () => {
    const engine = createMockTableEngine();
    engine._totalRows = 100;
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.selectAll();
    });

    expect(engine.selected_count()).toBe(25);
    expect(engine.all_selected()).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('deselectAll calls engine.deselect_all and notifies', () => {
    const engine = createMockTableEngine();
    engine._totalRows = 100;
    engine._selected.add(0);
    engine._selected.add(1);
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.deselectAll();
    });

    expect(engine.selected_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('setEditValue calls engine.set_edit_value and notifies', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setEditValue(2, 'price', '99.99');
    });

    expect(engine.edit_value(2, 'price')).toBe('99.99');
    expect(engine.is_cell_dirty(2, 'price')).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('commitEdits calls engine.commit_edits, notifies, and returns result', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setEditValue(0, 'name', 'Alice');
    });

    let commitResult: string;
    act(() => {
      commitResult = handle.commitEdits();
    });

    expect(JSON.parse(commitResult!)).toEqual({ '0:name': 'Alice' });
    expect(engine.has_edits()).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it('discardEdits calls engine.discard_edits and notifies', () => {
    const engine = createMockTableEngine();
    engine._edits.set('0:name', 'Alice');
    engine._editErrors.set('0:name', 'Too short');
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.discardEdits();
    });

    expect(engine.has_edits()).toBe(false);
    expect(engine.cell_error(0, 'name')).toBe('');
    expect(spy).toHaveBeenCalled();
  });

  it('setGroupBy calls engine.set_group_by and notifies', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setGroupBy('category');
    });

    expect(engine.group_by_column()).toBe('category');
    expect(engine.needs_fetch()).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('clearGroupBy calls engine.clear_group_by and notifies', () => {
    const engine = createMockTableEngine();
    engine._groupBy = 'category';
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.clearGroupBy();
    });

    expect(engine.group_by_column()).toBe('');
    expect(spy).toHaveBeenCalled();
  });

  it('toggleGroup calls engine.toggle_group and notifies', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.toggleGroup(0);
    });

    expect(engine.is_group_expanded(0)).toBe(true);
    expect(spy).toHaveBeenCalled();

    act(() => {
      handle.toggleGroup(0);
    });

    expect(engine.is_group_expanded(0)).toBe(false);
  });

  it('reset calls engine.reset and notifies', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    // Set some state first
    act(() => {
      handle.setPage(3);
      handle.setFilter('status', 'active');
      handle.toggleSort('price');
      handle.toggleRow(2);
      handle.setEditValue(0, 'name', 'Alice');
      handle.setGroupBy('category');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.reset();
    });

    expect(engine.page()).toBe(0);
    expect(engine.page_size()).toBe(25);
    expect(engine.sort_column()).toBe('');
    expect(engine.sort_direction()).toBe(0);
    expect(engine.filter_value('status')).toBe('');
    expect(engine.selected_count()).toBe(0);
    expect(engine.has_edits()).toBe(false);
    expect(engine.group_by_column()).toBe('');
    expect(engine.needs_fetch()).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it('getTableState reads all properties', () => {
    const engine = createMockTableEngine();
    engine._totalRows = 100;
    engine._editable = true;
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const state = handle.getTableState();
    expect(state).toEqual({
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

    act(() => {
      handle.setPage(2);
      handle.toggleSort('name');
    });

    const state2 = handle.getTableState();
    expect(state2.page).toBe(2);
    expect(state2.sortColumn).toBe('name');
    expect(state2.sortDirection).toBe(SortDirection.Asc);
    expect(state2.needsFetch).toBe(true);
    expect(state2.dataVersion).toBeGreaterThan(0);
  });

  it('needsFetch reads from engine', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    expect(handle.needsFetch()).toBe(false);

    act(() => {
      handle.setPage(1);
    });

    expect(handle.needsFetch()).toBe(true);
  });

  it('queryDescriptor reads from engine', () => {
    const engine = createMockTableEngine();
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    const descriptor = JSON.parse(handle.queryDescriptor());
    expect(descriptor.page).toBe(0);
    expect(descriptor.page_size).toBe(25);
    expect(descriptor.sort_column).toBe('');
    expect(descriptor.sort_direction).toBe(0);
  });

  it('acknowledgeFetch reads from engine', () => {
    const engine = createMockTableEngine();
    engine._needsFetch = true;
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    expect(handle.needsFetch()).toBe(true);
    handle.acknowledgeFetch();
    expect(handle.needsFetch()).toBe(false);
  });

  it('getPageBuffer returns null when no wasmMemory', () => {
    const engine = createMockTableEngine();
    engine._pageData = new Uint8Array([1, 2, 3]);
    const { result } = renderHook(() => useTableEngine(engine));
    const handle = result.current!;

    expect(handle.getPageBuffer()).toBe(null);
  });

  it('getPageBuffer returns null when page_len is 0', () => {
    const engine = createMockTableEngine();
    // pageData is empty by default so page_len() = 0
    const mockBuffer = new ArrayBuffer(1024);
    const mockMemory = { buffer: mockBuffer } as WebAssembly.Memory;
    const { result } = renderHook(() => useTableEngine(engine, mockMemory));
    const handle = result.current!;

    expect(handle.getPageBuffer()).toBe(null);
  });

  it('getPageBuffer returns Uint8Array view when wasmMemory is provided', () => {
    const engine = createMockTableEngine();
    engine._pageData = new Uint8Array([10, 20, 30]);
    const mockBuffer = new ArrayBuffer(1024);
    const mockMemory = { buffer: mockBuffer } as WebAssembly.Memory;
    const { result } = renderHook(() => useTableEngine(engine, mockMemory));
    const handle = result.current!;

    const buffer = handle.getPageBuffer();
    expect(buffer).not.toBe(null);
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer!.length).toBe(3);
  });
});
