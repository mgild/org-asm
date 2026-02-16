import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createSearchContext } from '../createSearchContext';
import type { ISearchEngine } from '../../core/interfaces';

interface MockFilter {
  field: string;
  op: number;
  value: string;
}

function createMockEngine(): ISearchEngine {
  const items: Record<string, unknown>[] = [];
  const filters: MockFilter[] = [];
  let query = '';
  let sort = { field: '', direction: 0 };
  let page = 0;
  let pageSize = 25;
  let version = 0;

  return {
    load_items(json: string) {
      const parsed = JSON.parse(json) as Record<string, unknown>[];
      items.length = 0;
      for (const item of parsed) items.push(item);
      version++;
    },
    clear_items() { items.length = 0; version++; },
    item_count() { return items.length; },
    result_count() { return items.length; },
    set_query(text: string) { query = text; version++; },
    current_query() { return query; },
    set_search_fields(_json: string) { version++; },
    add_filter(field: string, op: number, value: string) { filters.push({ field, op, value }); version++; },
    remove_filter(index: number) { filters.splice(index, 1); version++; },
    clear_filters() { filters.length = 0; version++; },
    filter_count() { return filters.length; },
    filter_field(index: number) { return filters[index]?.field ?? ''; },
    filter_op(index: number) { return filters[index]?.op ?? 0; },
    filter_value(index: number) { return filters[index]?.value ?? ''; },
    set_sort(field: string, direction: number) { sort = { field, direction }; version++; },
    clear_sort() { sort = { field: '', direction: 0 }; version++; },
    sort_field() { return sort.field; },
    sort_direction() { return sort.direction; },
    result_id(index: number) { return String(items[index]?.['id'] ?? ''); },
    result_value(index: number, field: string) { return String(items[index]?.[field] ?? ''); },
    set_page(p: number) { page = p; version++; },
    set_page_size(s: number) { pageSize = s; version++; },
    page() { return page; },
    page_size() { return pageSize; },
    page_count() { return items.length === 0 ? 0 : Math.ceil(items.length / pageSize); },
    facet_count(_field: string) { return 0; },
    facet_value(_field: string, _index: number) { return ''; },
    facet_item_count(_field: string, _value: string) { return 0; },
    data_version() { return version; },
    reset() {
      items.length = 0; filters.length = 0;
      query = ''; sort = { field: '', direction: 0 };
      page = 0; pageSize = 25; version++;
    },
  };
}

describe('createSearchContext', () => {
  it('useSearch returns handle from provider', () => {
    const ctx = createSearchContext<ISearchEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.SearchProvider engine={engine}>
        {children}
      </ctx.SearchProvider>
    );

    const { result } = renderHook(() => ctx.useSearch(), { wrapper });
    const handle = result.current;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.loadItems).toBe('function');
    expect(typeof handle.clearItems).toBe('function');
    expect(typeof handle.setQuery).toBe('function');
    expect(typeof handle.setSearchFields).toBe('function');
    expect(typeof handle.addFilter).toBe('function');
    expect(typeof handle.removeFilter).toBe('function');
    expect(typeof handle.clearFilters).toBe('function');
    expect(typeof handle.setSort).toBe('function');
    expect(typeof handle.clearSort).toBe('function');
    expect(typeof handle.setPage).toBe('function');
    expect(typeof handle.setPageSize).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getSearchState).toBe('function');
    expect(typeof handle.getResultId).toBe('function');
    expect(typeof handle.getResultValue).toBe('function');
    expect(typeof handle.getFacetCount).toBe('function');
    expect(typeof handle.getFacetValue).toBe('function');
    expect(typeof handle.getFacetItemCount).toBe('function');
  });

  it('useSearchResult returns result state from provider', () => {
    const ctx = createSearchContext<ISearchEngine>();
    const engine = createMockEngine();
    engine.load_items(JSON.stringify([
      { id: 'item-1', name: 'Widget' },
      { id: 'item-2', name: 'Gadget' },
    ]));

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.SearchProvider engine={engine}>
        {children}
      </ctx.SearchProvider>
    );

    const { result } = renderHook(() => ctx.useSearchResult(0), { wrapper });

    expect(result.current.index).toBe(0);
    expect(result.current.id).toBe('item-1');
    expect(result.current.exists).toBe(true);
  });

  it('useSearchStatus returns search state from provider', () => {
    const ctx = createSearchContext<ISearchEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.SearchProvider engine={engine}>
        {children}
      </ctx.SearchProvider>
    );

    const { result } = renderHook(() => ctx.useSearchStatus(), { wrapper });

    expect(result.current).toEqual({
      query: '',
      resultCount: 0,
      itemCount: 0,
      page: 0,
      pageSize: 25,
      pageCount: 0,
      sortField: '',
      sortDirection: 0,
      filterCount: 0,
      dataVersion: 0,
    });
  });

  it('useSearch throws outside provider', () => {
    const ctx = createSearchContext<ISearchEngine>();

    expect(() => {
      renderHook(() => ctx.useSearch());
    }).toThrow('useSearch must be used within a SearchProvider');
  });

  it('useSearchResult returns empty state outside provider (null handle)', () => {
    const ctx = createSearchContext<ISearchEngine>();

    const { result } = renderHook(() => ctx.useSearchResult(0));

    expect(result.current).toEqual({
      index: 0,
      id: '',
      exists: false,
    });
  });

  it('useSearchStatus returns empty state outside provider (null handle)', () => {
    const ctx = createSearchContext<ISearchEngine>();

    const { result } = renderHook(() => ctx.useSearchStatus());

    expect(result.current).toEqual({
      query: '',
      resultCount: 0,
      itemCount: 0,
      page: 0,
      pageSize: 25,
      pageCount: 0,
      sortField: '',
      sortDirection: 0,
      filterCount: 0,
      dataVersion: 0,
    });
  });

  it('children render correctly', () => {
    const ctx = createSearchContext<ISearchEngine>();
    const engine = createMockEngine();

    const { container } = render(
      <ctx.SearchProvider engine={engine}>
        <div data-testid="child">Hello from child</div>
      </ctx.SearchProvider>,
    );

    expect(container.textContent).toBe('Hello from child');
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('SearchProvider works with null engine', () => {
    const ctx = createSearchContext<ISearchEngine>();

    const { result } = renderHook(() => ctx.useSearchResult(0), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.SearchProvider engine={null}>
          {children}
        </ctx.SearchProvider>
      ),
    });

    expect(result.current).toEqual({
      index: 0,
      id: '',
      exists: false,
    });
  });

  it('mutations via useSearch propagate to useSearchResult and useSearchStatus', () => {
    const ctx = createSearchContext<ISearchEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.SearchProvider engine={engine}>
        {children}
      </ctx.SearchProvider>
    );

    const { result } = renderHook(
      () => ({
        search: ctx.useSearch(),
        result0: ctx.useSearchResult(0),
        status: ctx.useSearchStatus(),
      }),
      { wrapper },
    );

    expect(result.current.result0.exists).toBe(false);
    expect(result.current.status.itemCount).toBe(0);
    expect(result.current.status.query).toBe('');

    act(() => {
      result.current.search.loadItems(JSON.stringify([{ id: 'item-1', name: 'Alice' }]));
    });

    expect(result.current.result0.id).toBe('item-1');
    expect(result.current.result0.exists).toBe(true);
    expect(result.current.status.itemCount).toBe(1);

    act(() => {
      result.current.search.setQuery('alice');
    });

    expect(result.current.status.query).toBe('alice');
  });
});
