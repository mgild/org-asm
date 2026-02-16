/**
 * useSearchState — Top-level search state subscription.
 *
 * For search bars, result counts, pagination controls, and status indicators.
 * Re-renders only when search-level state (query, resultCount, page, etc.) changes.
 *
 * Usage:
 *   const { query, resultCount, page, pageCount } = useSearchState(handle);
 *   <span>{resultCount} results for "{query}"</span>
 */

import { useWasmSelector } from './useWasmSelector';
import type { SearchHandle } from './useSearchEngine';
import type { SearchState } from '../core/types';

const EMPTY_STATE: SearchState = {
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
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useSearchState(
  handle: SearchHandle | null,
): SearchState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
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
  );
}
