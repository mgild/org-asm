/**
 * createSearchContext — Context factory for sharing a SearchHandle across
 * a component tree without prop drilling.
 *
 * Mirrors the createFormContext pattern: create once per search engine type,
 * wrap at the root, read from any descendant.
 *
 * Usage:
 *   // context.ts
 *   export const { SearchProvider, useSearch, useSearchStatus, useSearchResult } = createSearchContext<MySearchEngine>();
 *
 *   // App.tsx
 *   <SearchProvider engine={engine}>
 *     <MySearchUI />
 *   </SearchProvider>
 *
 *   // Any descendant
 *   const { setQuery, addFilter } = useSearch();
 *   const { resultCount, page } = useSearchStatus();
 *   const { id, exists } = useSearchResult(0);
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useSearchEngine } from './useSearchEngine';
import { useSearchResult as useSearchResultHook } from './useSearchResult';
import { useSearchState } from './useSearchState';
import type { SearchHandle } from './useSearchEngine';
import type { ISearchEngine } from '../core/interfaces';
import type { SearchResult, SearchState } from '../core/types';

export interface SearchProviderProps<E extends ISearchEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface SearchContextValue<E extends ISearchEngine> {
  SearchProvider: (props: SearchProviderProps<E>) => ReactNode;
  useSearch: () => SearchHandle<E>;
  useSearchStatus: () => SearchState;
  useSearchResult: (index: number) => SearchResult;
}

export function createSearchContext<E extends ISearchEngine>(): SearchContextValue<E> {
  const HandleCtx = createContext<SearchHandle<E> | null>(null);

  function useSearch(): SearchHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useSearch must be used within a SearchProvider');
    }
    return ctx;
  }

  function useSearchStatus(): SearchState {
    const ctx = useContext(HandleCtx);
    return useSearchState(ctx);
  }

  function useSearchResult(index: number): SearchResult {
    const ctx = useContext(HandleCtx);
    return useSearchResultHook(ctx, index);
  }

  function SearchProvider({ engine, children }: SearchProviderProps<E>): ReactNode {
    const handle = useSearchEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { SearchProvider, useSearch, useSearchStatus, useSearchResult };
}
