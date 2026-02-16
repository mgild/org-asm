import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearchEngine } from '../useSearchEngine';
import type { ISearchEngine } from '../../core/interfaces';

interface MockFilter {
  field: string;
  op: number;
  value: string;
}

function createMockEngine(): ISearchEngine & {
  _items: Record<string, unknown>[];
  _query: string;
  _searchFields: string[];
  _filters: MockFilter[];
  _sort: { field: string; direction: number };
  _page: number;
  _pageSize: number;
} {
  const items: Record<string, unknown>[] = [];
  const filters: MockFilter[] = [];
  let query = '';
  let searchFields: string[] = [];
  let sort = { field: '', direction: 0 };
  let page = 0;
  let pageSize = 25;
  let version = 0;

  return {
    _items: items,
    _query: query,
    _searchFields: searchFields,
    _filters: filters,
    _sort: sort,
    _page: page,
    _pageSize: pageSize,

    load_items(json: string) {
      const parsed = JSON.parse(json) as Record<string, unknown>[];
      items.length = 0;
      for (const item of parsed) items.push(item);
      version++;
    },
    clear_items() {
      items.length = 0;
      version++;
    },
    item_count() { return items.length; },
    result_count() {
      // Simplified: return all items count (no actual filtering)
      return items.length;
    },

    set_query(text: string) {
      query = text;
      // Keep the external reference in sync
      (this as ReturnType<typeof createMockEngine>)._query = text;
      version++;
    },
    current_query() { return query; },
    set_search_fields(json: string) {
      searchFields = JSON.parse(json) as string[];
      (this as ReturnType<typeof createMockEngine>)._searchFields = searchFields;
      version++;
    },

    add_filter(field: string, op: number, value: string) {
      filters.push({ field, op, value });
      version++;
    },
    remove_filter(index: number) {
      filters.splice(index, 1);
      version++;
    },
    clear_filters() {
      filters.length = 0;
      version++;
    },
    filter_count() { return filters.length; },
    filter_field(index: number) { return filters[index]?.field ?? ''; },
    filter_op(index: number) { return filters[index]?.op ?? 0; },
    filter_value(index: number) { return filters[index]?.value ?? ''; },

    set_sort(field: string, direction: number) {
      sort = { field, direction };
      (this as ReturnType<typeof createMockEngine>)._sort = sort;
      version++;
    },
    clear_sort() {
      sort = { field: '', direction: 0 };
      (this as ReturnType<typeof createMockEngine>)._sort = sort;
      version++;
    },
    sort_field() { return sort.field; },
    sort_direction() { return sort.direction; },

    result_id(index: number) {
      const item = items[index];
      if (!item) return '';
      return String(item['id'] ?? '');
    },
    result_value(index: number, field: string) {
      const item = items[index];
      if (!item) return '';
      return String(item[field] ?? '');
    },

    set_page(p: number) {
      page = p;
      (this as ReturnType<typeof createMockEngine>)._page = p;
      version++;
    },
    set_page_size(s: number) {
      pageSize = s;
      (this as ReturnType<typeof createMockEngine>)._pageSize = s;
      version++;
    },
    page() { return page; },
    page_size() { return pageSize; },
    page_count() {
      if (items.length === 0) return 0;
      return Math.ceil(items.length / pageSize);
    },

    facet_count(_field: string) { return 0; },
    facet_value(_field: string, _index: number) { return ''; },
    facet_item_count(_field: string, _value: string) { return 0; },

    data_version() { return version; },
    reset() {
      items.length = 0;
      filters.length = 0;
      query = '';
      (this as ReturnType<typeof createMockEngine>)._query = '';
      searchFields = [];
      (this as ReturnType<typeof createMockEngine>)._searchFields = [];
      sort = { field: '', direction: 0 };
      (this as ReturnType<typeof createMockEngine>)._sort = sort;
      page = 0;
      (this as ReturnType<typeof createMockEngine>)._page = 0;
      pageSize = 25;
      (this as ReturnType<typeof createMockEngine>)._pageSize = 25;
      version++;
    },
  };
}

describe('useSearchEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useSearchEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns SearchHandle with all methods when engine is provided', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.notifier.subscribe).toBe('function');
    expect(typeof handle.notifier.notify).toBe('function');
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

  it('loadItems calls engine.load_items and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.loadItems(JSON.stringify([{ id: '1', name: 'Item 1' }]));
    });

    expect(engine.item_count()).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('clearItems calls engine.clear_items and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.loadItems(JSON.stringify([{ id: '1' }]));
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.clearItems();
    });

    expect(engine.item_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('setQuery calls engine.set_query and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setQuery('shoes');
    });

    expect(engine.current_query()).toBe('shoes');
    expect(spy).toHaveBeenCalled();
  });

  it('setSearchFields calls engine.set_search_fields and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setSearchFields(JSON.stringify(['name', 'description']));
    });

    expect(spy).toHaveBeenCalled();
  });

  it('addFilter calls engine.add_filter and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.addFilter('price', 3, '100');
    });

    expect(engine.filter_count()).toBe(1);
    expect(engine.filter_field(0)).toBe('price');
    expect(engine.filter_op(0)).toBe(3);
    expect(engine.filter_value(0)).toBe('100');
    expect(spy).toHaveBeenCalled();
  });

  it('removeFilter calls engine.remove_filter and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addFilter('price', 3, '100');
      handle.addFilter('category', 0, 'shoes');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.removeFilter(0);
    });

    expect(engine.filter_count()).toBe(1);
    expect(engine.filter_field(0)).toBe('category');
    expect(spy).toHaveBeenCalled();
  });

  it('clearFilters calls engine.clear_filters and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addFilter('price', 3, '100');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.clearFilters();
    });

    expect(engine.filter_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('setSort calls engine.set_sort and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setSort('price', 1);
    });

    expect(engine.sort_field()).toBe('price');
    expect(engine.sort_direction()).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('clearSort calls engine.clear_sort and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setSort('price', 1);
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.clearSort();
    });

    expect(engine.sort_field()).toBe('');
    expect(engine.sort_direction()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('setPage calls engine.set_page and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setPage(2);
    });

    expect(engine.page()).toBe(2);
    expect(spy).toHaveBeenCalled();
  });

  it('setPageSize calls engine.set_page_size and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setPageSize(50);
    });

    expect(engine.page_size()).toBe(50);
    expect(spy).toHaveBeenCalled();
  });

  it('reset calls engine.reset and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    // Set some state first
    act(() => {
      handle.loadItems(JSON.stringify([{ id: '1' }]));
      handle.setQuery('test');
      handle.addFilter('price', 3, '100');
      handle.setSort('name', 1);
      handle.setPage(2);
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.reset();
    });

    expect(engine.item_count()).toBe(0);
    expect(engine.current_query()).toBe('');
    expect(engine.filter_count()).toBe(0);
    expect(engine.sort_field()).toBe('');
    expect(engine.page()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('getSearchState reads all search-level properties', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    const state = handle.getSearchState();
    expect(state).toEqual({
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

    act(() => {
      handle.loadItems(JSON.stringify([{ id: '1', name: 'Alice' }]));
      handle.setQuery('alice');
    });

    const state2 = handle.getSearchState();
    expect(state2.itemCount).toBe(1);
    expect(state2.query).toBe('alice');
    expect(state2.dataVersion).toBeGreaterThan(0);
  });

  it('getResultId reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    expect(handle.getResultId(0)).toBe('');

    act(() => {
      handle.loadItems(JSON.stringify([{ id: 'item-1' }]));
    });

    expect(handle.getResultId(0)).toBe('item-1');
  });

  it('getResultValue reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.loadItems(JSON.stringify([{ id: '1', name: 'Widget' }]));
    });

    expect(handle.getResultValue(0, 'name')).toBe('Widget');
    expect(handle.getResultValue(0, 'missing')).toBe('');
  });

  it('getFacetCount reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    expect(handle.getFacetCount('category')).toBe(0);
  });

  it('getFacetValue reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    expect(handle.getFacetValue('category', 0)).toBe('');
  });

  it('getFacetItemCount reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useSearchEngine(engine));
    const handle = result.current!;

    expect(handle.getFacetItemCount('category', 'shoes')).toBe(0);
  });
});
