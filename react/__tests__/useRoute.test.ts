import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRoute } from '../useRoute';
import { createNotifier } from '../useWasmState';
import type { IRouterEngine } from '../../core/interfaces';
import type { RouterHandle } from '../useRouterEngine';
import type { RouteState, BreadcrumbItem } from '../../core/types';

function createMockRouterEngine(): IRouterEngine {
  let version = 0;
  let currentPath = '/';
  let currentRouteId = 'home';
  const queryParams = new Map<string, string>();
  const history: string[] = ['/'];
  let historyIdx = 0;

  return {
    navigate(path: string) { history.splice(historyIdx + 1); history.push(path); historyIdx++; currentPath = path; currentRouteId = path.replace(/^\//, '') || 'home'; version++; },
    replace(path: string) { history[historyIdx] = path; currentPath = path; currentRouteId = path.replace(/^\//, '') || 'home'; version++; },
    back() { if (historyIdx > 0) { historyIdx--; currentPath = history[historyIdx]; currentRouteId = currentPath.replace(/^\//, '') || 'home'; version++; } },
    forward() { if (historyIdx < history.length - 1) { historyIdx++; currentPath = history[historyIdx]; currentRouteId = currentPath.replace(/^\//, '') || 'home'; version++; } },
    current_path() { return currentPath; }, current_route_id() { return currentRouteId; },
    is_match(routeId: string) { return currentRouteId === routeId; },
    param() { return ''; }, param_count() { return 0; }, param_name() { return ''; },
    query_param(name: string) { return queryParams.get(name) ?? ''; },
    query_string() { return ''; },
    set_query_param(name: string, value: string) { queryParams.set(name, value); version++; },
    clear_query_params() { queryParams.clear(); version++; },
    query_param_count() { return queryParams.size; }, query_param_name() { return ''; },
    can_go_back() { return historyIdx > 0; }, can_go_forward() { return historyIdx < history.length - 1; },
    history_length() { return history.length; }, history_index() { return historyIdx; },
    pending_guard() { return ''; }, resolve_guard() { version++; },
    set_guard_result() { version++; }, is_route_allowed() { return true; },
    breadcrumb_count() { return 0; }, breadcrumb_label() { return ''; }, breadcrumb_path() { return ''; },
    data_version() { return version; },
    reset() { currentPath = '/'; currentRouteId = 'home'; queryParams.clear(); history.length = 0; history.push('/'); historyIdx = 0; version++; },
  };
}

function createHandle(engine: IRouterEngine): RouterHandle {
  const notifier = createNotifier();
  return {
    engine, notifier,
    push(path: string) { engine.navigate(path); notifier.notify(); },
    replace(path: string) { engine.replace(path); notifier.notify(); },
    back() { engine.back(); notifier.notify(); },
    forward() { engine.forward(); notifier.notify(); },
    setQueryParam(name: string, value: string) { engine.set_query_param(name, value); notifier.notify(); },
    clearQueryParams() { engine.clear_query_params(); notifier.notify(); },
    resolveGuard(allowed: boolean) { engine.resolve_guard(allowed); notifier.notify(); },
    setGuardResult(routeId: string, allowed: boolean) { engine.set_guard_result(routeId, allowed); notifier.notify(); },
    reset() { engine.reset(); notifier.notify(); },
    getRouteState(): RouteState { return { path: engine.current_path(), routeId: engine.current_route_id(), queryString: engine.query_string(), canGoBack: engine.can_go_back(), canGoForward: engine.can_go_forward(), historyLength: engine.history_length(), historyIndex: engine.history_index(), pendingGuard: engine.pending_guard(), dataVersion: engine.data_version() }; },
    getParam(name: string) { return engine.param(name); },
    getQueryParam(name: string) { return engine.query_param(name); },
    getBreadcrumbs(): BreadcrumbItem[] { const c = engine.breadcrumb_count(); const items: BreadcrumbItem[] = []; for (let i = 0; i < c; i++) items.push({ label: engine.breadcrumb_label(i), path: engine.breadcrumb_path(i) }); return items; },
  };
}

describe('useRoute', () => {
  it('returns empty RouteState when handle is null', () => {
    const { result } = renderHook(() => useRoute(null));
    expect(result.current).toEqual({ path: '', routeId: '', queryString: '', canGoBack: false, canGoForward: false, historyLength: 0, historyIndex: 0, pendingGuard: '', dataVersion: 0 });
  });

  it('returns correct route state', () => {
    const engine = createMockRouterEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useRoute(handle));
    expect(result.current.path).toBe('/');
    expect(result.current.routeId).toBe('home');
    expect(result.current.canGoBack).toBe(false);
  });

  it('reflects path change after navigate', () => {
    const engine = createMockRouterEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useRoute(handle));
    act(() => { handle.push('/users'); });
    expect(result.current.path).toBe('/users');
    expect(result.current.canGoBack).toBe(true);
  });

  it('reflects history navigation', () => {
    const engine = createMockRouterEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useRoute(handle));
    act(() => { handle.push('/a'); handle.push('/b'); });
    expect(result.current.historyLength).toBe(3);
    act(() => { handle.back(); });
    expect(result.current.path).toBe('/a');
    expect(result.current.canGoForward).toBe(true);
  });

  it('updates on reset', () => {
    const engine = createMockRouterEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useRoute(handle));
    act(() => { handle.push('/x'); });
    act(() => { handle.reset(); });
    expect(result.current.path).toBe('/');
  });
});
