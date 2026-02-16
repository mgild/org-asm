/**
 * createStateMachineContext — Context factory for sharing a StateMachineHandle
 * across a component tree without prop drilling.
 *
 * Usage:
 *   // context.ts
 *   export const { StateMachineProvider, useStateMachine, useStateMachineStatus, useStateMatch } = createStateMachineContext<MyEngine>();
 *
 *   // App.tsx
 *   <StateMachineProvider engine={engine}>
 *     <MyApp />
 *   </StateMachineProvider>
 *
 *   // Any descendant
 *   const { sendEvent, resolveGuard } = useStateMachine();
 *   const { currentState, pendingGuard } = useStateMachineStatus();
 *   const { isActive } = useStateMatch('loading');
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useStateMachineEngine } from './useStateMachineEngine';
import { useStateMachineState as useStateMachineStateHook } from './useStateMachineState';
import { useStateMatch as useStateMatchHook } from './useStateMatch';
import type { StateMachineHandle } from './useStateMachineEngine';
import type { IStateMachineEngine } from '../core/interfaces';
import type { StateMachineState, StateMatch } from '../core/types';

export interface StateMachineProviderProps<E extends IStateMachineEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface StateMachineContextValue<E extends IStateMachineEngine> {
  StateMachineProvider: (props: StateMachineProviderProps<E>) => ReactNode;
  useStateMachine: () => StateMachineHandle<E>;
  useStateMachineStatus: () => StateMachineState;
  useStateMatch: (stateId: string) => StateMatch;
}

export function createStateMachineContext<E extends IStateMachineEngine>(): StateMachineContextValue<E> {
  const HandleCtx = createContext<StateMachineHandle<E> | null>(null);

  function useStateMachine(): StateMachineHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useStateMachine must be used within a StateMachineProvider');
    }
    return ctx;
  }

  function useStateMachineStatus(): StateMachineState {
    const ctx = useContext(HandleCtx);
    return useStateMachineStateHook(ctx);
  }

  function useStateMatch(stateId: string): StateMatch {
    const ctx = useContext(HandleCtx);
    return useStateMatchHook(ctx, stateId);
  }

  function StateMachineProvider({ engine, children }: StateMachineProviderProps<E>): ReactNode {
    const handle = useStateMachineEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { StateMachineProvider, useStateMachine, useStateMachineStatus, useStateMatch };
}
