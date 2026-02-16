/**
 * createCommandPaletteContext — Context factory for sharing a CommandPaletteHandle
 * across a component tree without prop drilling.
 *
 * Mirrors the createSearchContext pattern: create once per engine type,
 * wrap at the root, read from any descendant.
 *
 * Usage:
 *   // context.ts
 *   export const { CommandPaletteProvider, useCommandPalette, useCommandPaletteStatus, useCommandPaletteResult } = createCommandPaletteContext<MyEngine>();
 *
 *   // App.tsx
 *   <CommandPaletteProvider engine={engine}>
 *     <MyPaletteUI />
 *   </CommandPaletteProvider>
 *
 *   // Any descendant
 *   const { setQuery, markExecuted } = useCommandPalette();
 *   const { resultCount, page } = useCommandPaletteStatus();
 *   const { id, label, score } = useCommandPaletteResult(0);
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useCommandPaletteEngine } from './useCommandPaletteEngine';
import { useCommandPaletteResult as useCommandPaletteResultHook } from './useCommandPaletteResult';
import { useCommandPaletteState } from './useCommandPaletteState';
import type { CommandPaletteHandle } from './useCommandPaletteEngine';
import type { ICommandPaletteEngine } from '../core/interfaces';
import type { CommandPaletteResult, CommandPaletteState } from '../core/types';

export interface CommandPaletteProviderProps<E extends ICommandPaletteEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface CommandPaletteContextValue<E extends ICommandPaletteEngine> {
  CommandPaletteProvider: (props: CommandPaletteProviderProps<E>) => ReactNode;
  useCommandPalette: () => CommandPaletteHandle<E>;
  useCommandPaletteStatus: () => CommandPaletteState;
  useCommandPaletteResult: (index: number) => CommandPaletteResult;
}

export function createCommandPaletteContext<E extends ICommandPaletteEngine>(): CommandPaletteContextValue<E> {
  const HandleCtx = createContext<CommandPaletteHandle<E> | null>(null);

  function useCommandPalette(): CommandPaletteHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useCommandPalette must be used within a CommandPaletteProvider');
    }
    return ctx;
  }

  function useCommandPaletteStatus(): CommandPaletteState {
    const ctx = useContext(HandleCtx);
    return useCommandPaletteState(ctx);
  }

  function useCommandPaletteResult(index: number): CommandPaletteResult {
    const ctx = useContext(HandleCtx);
    return useCommandPaletteResultHook(ctx, index);
  }

  function CommandPaletteProvider({ engine, children }: CommandPaletteProviderProps<E>): ReactNode {
    const handle = useCommandPaletteEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { CommandPaletteProvider, useCommandPalette, useCommandPaletteStatus, useCommandPaletteResult };
}
