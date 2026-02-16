/**
 * createVirtualScrollContext — Context factory for sharing a VirtualScrollHandle across
 * a component tree without prop drilling.
 *
 * Mirrors the createSearchContext pattern: create once per virtual scroll engine type,
 * wrap at the root, read from any descendant.
 *
 * Usage:
 *   // context.ts
 *   export const { VirtualScrollProvider, useVirtualScroll, useVirtualScrollStatus, useVirtualScrollItem } = createVirtualScrollContext<MyScrollEngine>();
 *
 *   // App.tsx
 *   <VirtualScrollProvider engine={engine}>
 *     <MyVirtualList />
 *   </VirtualScrollProvider>
 *
 *   // Any descendant
 *   const { setScrollOffset, scrollToIndex } = useVirtualScroll();
 *   const { visibleStart, visibleEnd } = useVirtualScrollStatus();
 *   const { top, height, isVisible } = useVirtualScrollItem(0);
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useVirtualScrollEngine } from './useVirtualScrollEngine';
import { useVirtualScrollItem as useVirtualScrollItemHook } from './useVirtualScrollItem';
import { useVirtualScrollState } from './useVirtualScrollState';
import type { VirtualScrollHandle } from './useVirtualScrollEngine';
import type { IVirtualScrollEngine } from '../core/interfaces';
import type { VirtualScrollItem, VirtualScrollState } from '../core/types';

export interface VirtualScrollProviderProps<E extends IVirtualScrollEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface VirtualScrollContextValue<E extends IVirtualScrollEngine> {
  VirtualScrollProvider: (props: VirtualScrollProviderProps<E>) => ReactNode;
  useVirtualScroll: () => VirtualScrollHandle<E>;
  useVirtualScrollStatus: () => VirtualScrollState;
  useVirtualScrollItem: (index: number) => VirtualScrollItem;
}

export function createVirtualScrollContext<E extends IVirtualScrollEngine>(): VirtualScrollContextValue<E> {
  const HandleCtx = createContext<VirtualScrollHandle<E> | null>(null);

  function useVirtualScroll(): VirtualScrollHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useVirtualScroll must be used within a VirtualScrollProvider');
    }
    return ctx;
  }

  function useVirtualScrollStatus(): VirtualScrollState {
    const ctx = useContext(HandleCtx);
    return useVirtualScrollState(ctx);
  }

  function useVirtualScrollItem(index: number): VirtualScrollItem {
    const ctx = useContext(HandleCtx);
    return useVirtualScrollItemHook(ctx, index);
  }

  function VirtualScrollProvider({ engine, children }: VirtualScrollProviderProps<E>): ReactNode {
    const handle = useVirtualScrollEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { VirtualScrollProvider, useVirtualScroll, useVirtualScrollStatus, useVirtualScrollItem };
}
