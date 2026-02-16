import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteMatch } from '../useRouteMatch';
import { createNotifier } from '../useWasmState';
import type { IRouterEngine } from '../../core/interfaces';
import type { RouterHandle } from '../useRouterEngine';
import type { RouteState, BreadcrumbItem } from '../../core/types';

function createMockRouterEngine(): IRouterEngine {
  let version = 0;
  let currentRouteId = 'home';
  const guardResults = new Map<string, boolean>();

  return {
    navigate(path: string) { currentRouteId = path.replace(/^\//, '') || 'home'; version++; },
    replace(path: string) { currentRouteId = path.replace(/^\//, '') || 'home'; version++; },
    back() { version++; }, forward() { version++; },
    current_path() { return '/' + currentRouteId; }, current_route_id() { return currentRouteId; },
    is_match(routeId: string) { return currentRouteId === routeId; },
    param() { return ''; }, param_count() { return 0; }, param_name() { return ''; },
    query_param() { return ''; }, query_string() { return ''; },
    set_query_param() { version++; }, clear_query_params() { version++; },
    query_param_count() { return 0; }, query_param_name() { return ''; },
    can_go_back() { return false; }, can_go_forward() { return false; },
    history_length() { return 1; }, history_index() { return 0; },
    pending_guard() { return ''; }, resolve_guard() { version++; },
    set_guard_result(routeId: string, allowed: boolean) { guardResults.set(routeId, allowed); version++; },
    is_route_allowed(routeId: string) { return guardResults.get(routeId) ?? true; },
    breadcrumb_count() { return 0; }, breadcrumb_label() { return ''; }, breadcrumb_path() { return ''; },
    data_version() { return version; },
    reset() { currentRouteId = 'home'; guardResults.clear(); version++; },
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
    setQueryParam(n: string, v: string) { engine.set_query_param(n, v); notifier.notify(); },
    clearQueryParams() { engine.clear_query_params(); notifier.notify(); },
    resolveGuard(a: boolean) { engine.resolve_guard(a); notifier.notify(); },
    setGuardResult(r: string, a: boolean) { engine.set_guard_result(r, a); notifier.notify(); },
    reset() { engine.reset(); notifier.notify(); },
    getRouteState(): RouteState { return { path: '', routeId: '', queryString: '', canGoBack: false, canGoForward: false, historyLength: 0, historyIndex: 0, pendingGuard: '', dataVersion: 0 }; },
    getParam(n: string) { return engine.param(n); },
    getQueryParam(n: string) { return engine.query_param(n); },
    getBreadcrumbs(): BreadcrumbItem[] { return []; },
  };
}

describe('useRouteMatch', () => {
  it('returns empty RouteMatch when handle is null', () => {
    const { result } = renderHook(() => useRouteMatch(null, 'home'));
    expect(result.current).toEqual({ routeId: '', isMatch: false, isAllowed: false });
  });

  it('returns correct match state', () => {
    const engine = createMockRouterEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useRouteMatch(handle, 'home'));
    expect(result.current).toEqual({ routeId: 'home', isMatch: true, isAllowed: true });
  });

  it('returns false for non-matching route', () => {
    const engine = createMockRouterEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useRouteMatch(handle, 'settings'));
    expect(result.current.isMatch).toBe(false);
  });

  it('reflects guard deny', () => {
    const engine = createMockRouterEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useRouteMatch(handle, 'admin'));
    expect(result.current.isAllowed).toBe(true);
    act(() => { handle.setGuardResult('admin', false); });
    expect(result.current.isAllowed).toBe(false);
  });

  it('updates on navigate', () => {
    const engine = createMockRouterEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useRouteMatch(handle, 'users'));
    expect(result.current.isMatch).toBe(false);
    act(() => { handle.push('/users'); });
    expect(result.current.isMatch).toBe(true);
  });
});
