/**
 * createHistoryContext — Context factory for sharing a HistoryHandle across
 * a component tree without prop drilling.
 *
 * Usage:
 *   // context.ts
 *   export const { HistoryProvider, useHistory, useHistoryStatus, useUndoItem, useRedoItem } = createHistoryContext<MyHistoryEngine>();
 *
 *   // App.tsx
 *   <HistoryProvider engine={engine}>
 *     <MyApp />
 *   </HistoryProvider>
 *
 *   // Any descendant
 *   const { undo, redo, pushCommand } = useHistory();
 *   const { canUndo, canRedo } = useHistoryStatus();
 *   const { label } = useUndoItem(0);
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useHistoryEngine } from './useHistoryEngine';
import { useUndoEntry } from './useUndoEntry';
import { useRedoEntry } from './useRedoEntry';
import { useHistoryState } from './useHistoryState';
import type { HistoryHandle } from './useHistoryEngine';
import type { IHistoryEngine } from '../core/interfaces';
import type { HistoryState, CommandEntry } from '../core/types';

export interface HistoryProviderProps<E extends IHistoryEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface HistoryContextValue<E extends IHistoryEngine> {
  HistoryProvider: (props: HistoryProviderProps<E>) => ReactNode;
  useHistory: () => HistoryHandle<E>;
  useHistoryStatus: () => HistoryState;
  useUndoItem: (index: number) => CommandEntry;
  useRedoItem: (index: number) => CommandEntry;
}

export function createHistoryContext<E extends IHistoryEngine>(): HistoryContextValue<E> {
  const HandleCtx = createContext<HistoryHandle<E> | null>(null);

  function useHistory(): HistoryHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useHistory must be used within a HistoryProvider');
    }
    return ctx;
  }

  function useUndoItem(index: number): CommandEntry {
    const ctx = useContext(HandleCtx);
    return useUndoEntry(ctx, index);
  }

  function useRedoItem(index: number): CommandEntry {
    const ctx = useContext(HandleCtx);
    return useRedoEntry(ctx, index);
  }

  function useHistoryStatus(): HistoryState {
    const ctx = useContext(HandleCtx);
    return useHistoryState(ctx);
  }

  function HistoryProvider({ engine, children }: HistoryProviderProps<E>): ReactNode {
    const handle = useHistoryEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { HistoryProvider, useHistory, useHistoryStatus, useUndoItem, useRedoItem };
}
