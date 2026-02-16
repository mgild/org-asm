/**
 * createApiContext — Context factory for sharing an ApiHandle across
 * a component tree without prop drilling.
 *
 * Mirrors the createFormContext pattern: create once per API engine type,
 * wrap at the root, read from any descendant.
 *
 * Usage:
 *   // context.ts
 *   export const { ApiProvider, useApi, useApiStatus, useRequest } = createApiContext<MyApiEngine>();
 *
 *   // App.tsx
 *   <ApiProvider engine={engine}>
 *     <MyApp />
 *   </ApiProvider>
 *
 *   // Any descendant
 *   const { beginRequest, setRequestSuccess } = useApi();
 *   const { activeRequestCount } = useApiStatus();
 *   const { status, error } = useRequest(requestId);
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useApiEngine } from './useApiEngine';
import { useApiState } from './useApiState';
import { useRequest as useRequestHook } from './useRequest';
import type { ApiHandle } from './useApiEngine';
import type { IApiEngine } from '../core/interfaces';
import type { ApiState, RequestState } from '../core/types';

export interface ApiProviderProps<E extends IApiEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface ApiContextValue<E extends IApiEngine> {
  ApiProvider: (props: ApiProviderProps<E>) => ReactNode;
  useApi: () => ApiHandle<E>;
  useApiStatus: () => ApiState;
  useRequest: (requestId: number) => RequestState;
}

export function createApiContext<E extends IApiEngine>(): ApiContextValue<E> {
  const HandleCtx = createContext<ApiHandle<E> | null>(null);

  function useApi(): ApiHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useApi must be used within an ApiProvider');
    }
    return ctx;
  }

  function useApiStatus(): ApiState {
    const ctx = useContext(HandleCtx);
    return useApiState(ctx);
  }

  function useRequest(requestId: number): RequestState {
    const ctx = useContext(HandleCtx);
    return useRequestHook(ctx, requestId);
  }

  function ApiProvider({ engine, children }: ApiProviderProps<E>): ReactNode {
    const handle = useApiEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { ApiProvider, useApi, useApiStatus, useRequest };
}
