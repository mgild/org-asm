import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createTableContext } from '../createTableContext';
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

describe('createTableContext', () => {
  it('useTable returns handle from provider', () => {
    const ctx = createTableContext<ITableEngine>();
    const engine = createMockTableEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.TableProvider engine={engine}>
        {children}
      </ctx.TableProvider>
    );

    const { result } = renderHook(() => ctx.useTable(), { wrapper });
    const handle = result.current;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
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
    expect(typeof handle.ingestPage).toBe('function');
  });

  it('useRow returns row state from provider', () => {
    const ctx = createTableContext<ITableEngine>();
    const engine = createMockTableEngine();
    engine._selected.add(3);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.TableProvider engine={engine}>
        {children}
      </ctx.TableProvider>
    );

    const { result } = renderHook(() => ctx.useRow(3), { wrapper });

    expect(result.current.rowIndex).toBe(3);
    expect(result.current.selected).toBe(true);
  });

  it('useCell returns cell state from provider', () => {
    const ctx = createTableContext<ITableEngine>();
    const engine = createMockTableEngine();
    engine._edits.set('2:price', '99.99');
    engine._editErrors.set('2:price', 'Too high');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.TableProvider engine={engine}>
        {children}
      </ctx.TableProvider>
    );

    const { result } = renderHook(() => ctx.useCell(2, 'price'), { wrapper });

    expect(result.current.value).toBe('99.99');
    expect(result.current.error).toBe('Too high');
    expect(result.current.dirty).toBe(true);
  });

  it('useTableStatus returns table state from provider', () => {
    const ctx = createTableContext<ITableEngine>();
    const engine = createMockTableEngine();
    engine._totalRows = 100;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.TableProvider engine={engine}>
        {children}
      </ctx.TableProvider>
    );

    const { result } = renderHook(() => ctx.useTableStatus(), { wrapper });

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

  it('useTable throws outside provider', () => {
    const ctx = createTableContext<ITableEngine>();

    expect(() => {
      renderHook(() => ctx.useTable());
    }).toThrow('useTable must be used within a TableProvider');
  });

  it('useRow returns empty state outside provider', () => {
    const ctx = createTableContext<ITableEngine>();

    const { result } = renderHook(() => ctx.useRow(0));

    expect(result.current).toEqual({
      rowIndex: -1,
      selected: false,
    });
  });

  it('useCell returns empty state outside provider', () => {
    const ctx = createTableContext<ITableEngine>();

    const { result } = renderHook(() => ctx.useCell(0, 'name'));

    expect(result.current).toEqual({
      value: '',
      error: '',
      dirty: false,
    });
  });

  it('useTableStatus returns empty state outside provider', () => {
    const ctx = createTableContext<ITableEngine>();

    const { result } = renderHook(() => ctx.useTableStatus());

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

  it('children render correctly', () => {
    const ctx = createTableContext<ITableEngine>();
    const engine = createMockTableEngine();

    const { container } = render(
      <ctx.TableProvider engine={engine}>
        <div data-testid="child">Hello from child</div>
      </ctx.TableProvider>,
    );

    expect(container.textContent).toBe('Hello from child');
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('TableProvider works with null engine', () => {
    const ctx = createTableContext<ITableEngine>();

    const { result } = renderHook(() => ctx.useRow(0), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.TableProvider engine={null}>
          {children}
        </ctx.TableProvider>
      ),
    });

    expect(result.current).toEqual({
      rowIndex: -1,
      selected: false,
    });
  });

  it('mutations via useTable propagate to useRow, useCell, useTableStatus', () => {
    const ctx = createTableContext<ITableEngine>();
    const engine = createMockTableEngine();
    engine._totalRows = 100;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.TableProvider engine={engine}>
        {children}
      </ctx.TableProvider>
    );

    const { result } = renderHook(
      () => ({
        table: ctx.useTable(),
        row: ctx.useRow(3),
        cell: ctx.useCell(3, 'name'),
        status: ctx.useTableStatus(),
      }),
      { wrapper },
    );

    expect(result.current.row.selected).toBe(false);
    expect(result.current.cell.value).toBe('');
    expect(result.current.status.selectedCount).toBe(0);
    expect(result.current.status.hasEdits).toBe(false);

    act(() => {
      result.current.table.toggleRow(3);
    });

    expect(result.current.row.selected).toBe(true);
    expect(result.current.status.selectedCount).toBe(1);

    act(() => {
      result.current.table.setEditValue(3, 'name', 'Alice');
    });

    expect(result.current.cell.value).toBe('Alice');
    expect(result.current.cell.dirty).toBe(true);
    expect(result.current.status.hasEdits).toBe(true);
  });
});
