/**
 * useSearchResult — Per-result subscription via useWasmSelector.
 *
 * Only this result's component re-renders when its state changes.
 * Other results remain untouched thanks to structural equality.
 *
 * Usage:
 *   const { id, exists } = useSearchResult(handle, 0);
 *   if (exists) {
 *     const name = handle.getResultValue(0, 'name');
 *     <div>{name}</div>
 *   }
 */

import { useWasmSelector } from './useWasmSelector';
import type { SearchHandle } from './useSearchEngine';
import type { SearchResult } from '../core/types';

const EMPTY_RESULT: SearchResult = {
  index: 0,
  id: '',
  exists: false,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useSearchResult(
  handle: SearchHandle | null,
  index: number,
): SearchResult {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_RESULT;
      const { engine } = handle;
      const id = engine.result_id(index);
      const exists = id !== '';
      return { index, id, exists };
    },
  );
}
