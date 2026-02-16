/**
 * useRouterEngine — Creates a RouterHandle wrapping a Rust IRouterEngine.
 *
 * The handle provides dispatch functions (push, replace, back, forward, etc.)
 * that mutate the engine and notify subscribers. Route-level and per-match
 * hooks subscribe via the notifier to re-render on changes.
 *
 * Usage:
 *   const engine = useMemo(() => new MyRouterEngine(), []);
 *   const handle = useRouterEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.push('/users/123');
 *   handle.back();
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { IRouterEngine } from '../core/interfaces';
import type { RouteState, BreadcrumbItem } from '../core/types';

export interface RouterHandle<E extends IRouterEngine = IRouterEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;
  // Dispatch (mutate + notify)
  push(path: string): void;
  replace(path: string): void;
  back(): void;
  forward(): void;
  setQueryParam(name: string, value: string): void;
  clearQueryParams(): void;
  resolveGuard(allowed: boolean): void;
  setGuardResult(routeId: string, allowed: boolean): void;
  reset(): void;
  // Reads (no notify)
  getRouteState(): RouteState;
  getParam(name: string): string;
  getQueryParam(name: string): string;
  getBreadcrumbs(): BreadcrumbItem[];
}

export function useRouterEngine<E extends IRouterEngine>(
  engine: E | null,
): RouterHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

    return {
      engine,
      notifier,
      push(path: string): void {
        engine.navigate(path);
        notifier.notify();
      },
      replace(path: string): void {
        engine.replace(path);
        notifier.notify();
      },
      back(): void {
        engine.back();
        notifier.notify();
      },
      forward(): void {
        engine.forward();
        notifier.notify();
      },
      setQueryParam(name: string, value: string): void {
        engine.set_query_param(name, value);
        notifier.notify();
      },
      clearQueryParams(): void {
        engine.clear_query_params();
        notifier.notify();
      },
      resolveGuard(allowed: boolean): void {
        engine.resolve_guard(allowed);
        notifier.notify();
      },
      setGuardResult(routeId: string, allowed: boolean): void {
        engine.set_guard_result(routeId, allowed);
        notifier.notify();
      },
      reset(): void {
        engine.reset();
        notifier.notify();
      },
      getRouteState(): RouteState {
        return {
          path: engine.current_path(),
          routeId: engine.current_route_id(),
          queryString: engine.query_string(),
          canGoBack: engine.can_go_back(),
          canGoForward: engine.can_go_forward(),
          historyLength: engine.history_length(),
          historyIndex: engine.history_index(),
          pendingGuard: engine.pending_guard(),
          dataVersion: engine.data_version(),
        };
      },
      getParam(name: string): string {
        return engine.param(name);
      },
      getQueryParam(name: string): string {
        return engine.query_param(name);
      },
      getBreadcrumbs(): BreadcrumbItem[] {
        const count = engine.breadcrumb_count();
        const items: BreadcrumbItem[] = [];
        for (let i = 0; i < count; i++) {
          items.push({
            label: engine.breadcrumb_label(i),
            path: engine.breadcrumb_path(i),
          });
        }
        return items;
      },
    };
  }, [engine, notifier]);
}
