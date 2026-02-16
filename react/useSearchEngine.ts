/**
 * useSearchEngine — Creates a SearchHandle wrapping a Rust ISearchEngine.
 *
 * The handle provides dispatch functions (setQuery, addFilter, setSort, etc.)
 * that mutate the engine and notify subscribers. Per-result and search-level
 * hooks (useSearchResult, useSearchState) subscribe via the notifier.
 *
 * Usage:
 *   const engine = useMemo(() => new MySearchEngine(), []);
 *   const handle = useSearchEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.setQuery('shoes');
 *   handle.addFilter('price', FilterOp.Lt, '100');
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { ISearchEngine } from '../core/interfaces';
import type { SearchState } from '../core/types';

export interface SearchHandle<E extends ISearchEngine = ISearchEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;

  // Dispatch functions (mutate engine + notify)
  loadItems(json: string): void;
  clearItems(): void;
  setQuery(text: string): void;
  setSearchFields(json: string): void;
  addFilter(field: string, op: number, value: string): void;
  removeFilter(index: number): void;
  clearFilters(): void;
  setSort(field: string, direction: number): void;
  clearSort(): void;
  setPage(page: number): void;
  setPageSize(size: number): void;
  reset(): void;

  // Reads (no notify)
  getSearchState(): SearchState;
  getResultId(index: number): string;
  getResultValue(index: number, field: string): string;
  getFacetCount(field: string): number;
  getFacetValue(field: string, index: number): string;
  getFacetItemCount(field: string, value: string): number;
}

export function useSearchEngine<E extends ISearchEngine>(
  engine: E | null,
): SearchHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

    return {
      engine,
      notifier,

      loadItems(json: string): void {
        engine.load_items(json);
        notifier.notify();
      },
      clearItems(): void {
        engine.clear_items();
        notifier.notify();
      },
      setQuery(text: string): void {
        engine.set_query(text);
        notifier.notify();
      },
      setSearchFields(json: string): void {
        engine.set_search_fields(json);
        notifier.notify();
      },
      addFilter(field: string, op: number, value: string): void {
        engine.add_filter(field, op, value);
        notifier.notify();
      },
      removeFilter(index: number): void {
        engine.remove_filter(index);
        notifier.notify();
      },
      clearFilters(): void {
        engine.clear_filters();
        notifier.notify();
      },
      setSort(field: string, direction: number): void {
        engine.set_sort(field, direction);
        notifier.notify();
      },
      clearSort(): void {
        engine.clear_sort();
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
      reset(): void {
        engine.reset();
        notifier.notify();
      },

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
      getResultId(index: number): string {
        return engine.result_id(index);
      },
      getResultValue(index: number, field: string): string {
        return engine.result_value(index, field);
      },
      getFacetCount(field: string): number {
        return engine.facet_count(field);
      },
      getFacetValue(field: string, index: number): string {
        return engine.facet_value(field, index);
      },
      getFacetItemCount(field: string, value: string): number {
        return engine.facet_item_count(field, value);
      },
    };
  }, [engine, notifier]);
}
