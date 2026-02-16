import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearchResult } from '../useSearchResult';
import { createNotifier } from '../useWasmState';
import type { ISearchEngine } from '../../core/interfaces';
import type { SearchHandle } from '../useSearchEngine';
import type { SearchState } from '../../core/types';

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

function createHandle(engine: ISearchEngine): SearchHandle {
  const notifier = createNotifier();
  return {
    engine,
    notifier,
    loadItems(json: string): void { engine.load_items(json); notifier.notify(); },
    clearItems(): void { engine.clear_items(); notifier.notify(); },
    setQuery(text: string): void { engine.set_query(text); notifier.notify(); },
    setSearchFields(json: string): void { engine.set_search_fields(json); notifier.notify(); },
    addFilter(field: string, op: number, value: string): void { engine.add_filter(field, op, value); notifier.notify(); },
    removeFilter(index: number): void { engine.remove_filter(index); notifier.notify(); },
    clearFilters(): void { engine.clear_filters(); notifier.notify(); },
    setSort(field: string, direction: number): void { engine.set_sort(field, direction); notifier.notify(); },
    clearSort(): void { engine.clear_sort(); notifier.notify(); },
    setPage(page: number): void { engine.set_page(page); notifier.notify(); },
    setPageSize(size: number): void { engine.set_page_size(size); notifier.notify(); },
    reset(): void { engine.reset(); notifier.notify(); },
    getSearchState(): SearchState {
      return {
        query: engine.current_query(),
        resultCount: engine.result_count(),
        itemCount: engine.item_count(),
        page: engine.page(),
        pageSize: engine.page_size(),
        pageCount: engine.page_count(),
        sortField: engine.sort_field(),
        sortDirection: engine.sort_direction(),
        filterCount: engine.filter_count(),
        dataVersion: engine.data_version(),
      };
    },
    getResultId(index: number): string { return engine.result_id(index); },
    getResultValue(index: number, field: string): string { return engine.result_value(index, field); },
    getFacetCount(field: string): number { return engine.facet_count(field); },
    getFacetValue(field: string, index: number): string { return engine.facet_value(field, index); },
    getFacetItemCount(field: string, value: string): number { return engine.facet_item_count(field, value); },
  };
}

describe('useSearchResult', () => {
  it('returns empty SearchResult when handle is null', () => {
    const { result } = renderHook(() => useSearchResult(null, 0));
    expect(result.current).toEqual({
      index: 0,
      id: '',
      exists: false,
    });
  });

  it('returns correct result state (index, id, exists) when item exists', () => {
    const engine = createMockEngine();
    engine.load_items(JSON.stringify([
      { id: 'item-1', name: 'Widget' },
      { id: 'item-2', name: 'Gadget' },
    ]));
    const handle = createHandle(engine);

    const { result } = renderHook(() => useSearchResult(handle, 0));

    expect(result.current.index).toBe(0);
    expect(result.current.id).toBe('item-1');
    expect(result.current.exists).toBe(true);
  });

  it('returns exists=false when result_id is empty (out of range)', () => {
    const engine = createMockEngine();
    engine.load_items(JSON.stringify([{ id: 'item-1' }]));
    const handle = createHandle(engine);

    const { result } = renderHook(() => useSearchResult(handle, 5));

    expect(result.current.index).toBe(5);
    expect(result.current.id).toBe('');
    expect(result.current.exists).toBe(false);
  });

  it('returns correct index for second result', () => {
    const engine = createMockEngine();
    engine.load_items(JSON.stringify([
      { id: 'first' },
      { id: 'second' },
    ]));
    const handle = createHandle(engine);

    const { result } = renderHook(() => useSearchResult(handle, 1));

    expect(result.current.index).toBe(1);
    expect(result.current.id).toBe('second');
    expect(result.current.exists).toBe(true);
  });

  it('updates on notify (re-renders with new result)', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useSearchResult(handle, 0));
    expect(result.current.exists).toBe(false);
    expect(result.current.id).toBe('');

    act(() => {
      handle.loadItems(JSON.stringify([{ id: 'new-item' }]));
    });

    expect(result.current.id).toBe('new-item');
    expect(result.current.exists).toBe(true);
  });

  it('reflects cleared items', () => {
    const engine = createMockEngine();
    engine.load_items(JSON.stringify([{ id: 'item-1' }]));
    const handle = createHandle(engine);

    const { result } = renderHook(() => useSearchResult(handle, 0));
    expect(result.current.exists).toBe(true);

    act(() => {
      handle.clearItems();
    });

    expect(result.current.exists).toBe(false);
    expect(result.current.id).toBe('');
  });

  it('returns empty result for handle with no items', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useSearchResult(handle, 0));

    expect(result.current).toEqual({
      index: 0,
      id: '',
      exists: false,
    });
  });
});
