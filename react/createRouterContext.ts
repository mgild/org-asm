/**
 * createRouterContext — Context factory for sharing a RouterHandle across
 * a component tree without prop drilling.
 *
 * Usage:
 *   // context.ts
 *   export const { RouterProvider, useRouter, useRoute, useRouteMatch } = createRouterContext<MyRouterEngine>();
 *
 *   // App.tsx
 *   <RouterProvider engine={engine}>
 *     <MyApp />
 *   </RouterProvider>
 *
 *   // Any descendant
 *   const { push, back } = useRouter();
 *   const { path, canGoBack } = useRoute();
 *   const { isMatch } = useRouteMatch('dashboard');
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useRouterEngine } from './useRouterEngine';
import { useRoute as useRouteHook } from './useRoute';
import { useRouteMatch as useRouteMatchHook } from './useRouteMatch';
import type { RouterHandle } from './useRouterEngine';
import type { IRouterEngine } from '../core/interfaces';
import type { RouteState, RouteMatch } from '../core/types';

export interface RouterProviderProps<E extends IRouterEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface RouterContextValue<E extends IRouterEngine> {
  RouterProvider: (props: RouterProviderProps<E>) => ReactNode;
  useRouter: () => RouterHandle<E>;
  useRoute: () => RouteState;
  useRouteMatch: (routeId: string) => RouteMatch;
}

export function createRouterContext<E extends IRouterEngine>(): RouterContextValue<E> {
  const HandleCtx = createContext<RouterHandle<E> | null>(null);

  function useRouter(): RouterHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useRouter must be used within a RouterProvider');
    }
    return ctx;
  }

  function useRoute(): RouteState {
    const ctx = useContext(HandleCtx);
    return useRouteHook(ctx);
  }

  function useRouteMatch(routeId: string): RouteMatch {
    const ctx = useContext(HandleCtx);
    return useRouteMatchHook(ctx, routeId);
  }

  function RouterProvider({ engine, children }: RouterProviderProps<E>): ReactNode {
    const handle = useRouterEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { RouterProvider, useRouter, useRoute, useRouteMatch };
}
