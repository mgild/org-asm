/**
 * createSelectionContext — Context factory for sharing a SelectionHandle across
 * a component tree without prop drilling.
 *
 * Mirrors the createSearchContext pattern: create once per selection engine type,
 * wrap at the root, read from any descendant.
 *
 * Usage:
 *   // context.ts
 *   export const { SelectionProvider, useSelection, useSelectionStatus, useSelectionItem } = createSelectionContext<MySelectionEngine>();
 *
 *   // App.tsx
 *   <SelectionProvider engine={engine}>
 *     <MySelectionUI />
 *   </SelectionProvider>
 *
 *   // Any descendant
 *   const { select, toggle, deselectAll } = useSelection();
 *   const { selectedCount, mode } = useSelectionStatus();
 *   const { isSelected, isFocused } = useSelectionItem('item-1');
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useSelectionEngine } from './useSelectionEngine';
import { useSelectionItem as useSelectionItemHook } from './useSelectionItem';
import { useSelectionState } from './useSelectionState';
import type { SelectionHandle } from './useSelectionEngine';
import type { ISelectionEngine } from '../core/interfaces';
import type { SelectionItem, SelectionState } from '../core/types';

export interface SelectionProviderProps<E extends ISelectionEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface SelectionContextValue<E extends ISelectionEngine> {
  SelectionProvider: (props: SelectionProviderProps<E>) => ReactNode;
  useSelection: () => SelectionHandle<E>;
  useSelectionStatus: () => SelectionState;
  useSelectionItem: (id: string) => SelectionItem;
}

export function createSelectionContext<E extends ISelectionEngine>(): SelectionContextValue<E> {
  const HandleCtx = createContext<SelectionHandle<E> | null>(null);

  function useSelection(): SelectionHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useSelection must be used within a SelectionProvider');
    }
    return ctx;
  }

  function useSelectionStatus(): SelectionState {
    const ctx = useContext(HandleCtx);
    return useSelectionState(ctx);
  }

  function useSelectionItem(id: string): SelectionItem {
    const ctx = useContext(HandleCtx);
    return useSelectionItemHook(ctx, id);
  }

  function SelectionProvider({ engine, children }: SelectionProviderProps<E>): ReactNode {
    const handle = useSelectionEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { SelectionProvider, useSelection, useSelectionStatus, useSelectionItem };
}
