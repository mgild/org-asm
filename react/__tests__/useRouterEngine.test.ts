import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouterEngine } from '../useRouterEngine';
import type { IRouterEngine } from '../../core/interfaces';

interface MockRouterEngine extends IRouterEngine {
  readonly _breadcrumbs: Array<{ label: string; path: string }>;
}

function createMockRouterEngine(): MockRouterEngine {
  let version = 0;
  let currentPath = '/';
  let currentRouteId = 'home';
  const params = new Map<string, string>();
  const queryParams = new Map<string, string>();
  const history: string[] = ['/'];
  let historyIdx = 0;
  let pendingGuardRoute = '';
  const guardResults = new Map<string, boolean>();
  const breadcrumbs: Array<{ label: string; path: string }> = [];

  return {
    _breadcrumbs: breadcrumbs,
    navigate(path: string) {
      history.splice(historyIdx + 1);
      history.push(path);
      historyIdx = history.length - 1;
      currentPath = path;
      currentRouteId = path.replace(/^\//, '') || 'home';
      version++;
    },
    replace(path: string) {
      history[historyIdx] = path;
      currentPath = path;
      currentRouteId = path.replace(/^\//, '') || 'home';
      version++;
    },
    back() {
      if (historyIdx > 0) {
        historyIdx--;
        currentPath = history[historyIdx];
        currentRouteId = currentPath.replace(/^\//, '') || 'home';
        version++;
      }
    },
    forward() {
      if (historyIdx < history.length - 1) {
        historyIdx++;
        currentPath = history[historyIdx];
        currentRouteId = currentPath.replace(/^\//, '') || 'home';
        version++;
      }
    },
    current_path() { return currentPath; },
    current_route_id() { return currentRouteId; },
    is_match(routeId: string) { return currentRouteId === routeId; },
    param(name: string) { return params.get(name) ?? ''; },
    param_count() { return params.size; },
    param_name(index: number) { return [...params.keys()][index] ?? ''; },
    query_param(name: string) { return queryParams.get(name) ?? ''; },
    query_string() {
      const entries = [...queryParams.entries()].map(([k, v]) => `${k}=${v}`);
      return entries.length > 0 ? `?${entries.join('&')}` : '';
    },
    set_query_param(name: string, value: string) { queryParams.set(name, value); version++; },
    clear_query_params() { queryParams.clear(); version++; },
    query_param_count() { return queryParams.size; },
    query_param_name(index: number) { return [...queryParams.keys()][index] ?? ''; },
    can_go_back() { return historyIdx > 0; },
    can_go_forward() { return historyIdx < history.length - 1; },
    history_length() { return history.length; },
    history_index() { return historyIdx; },
    pending_guard() { return pendingGuardRoute; },
    resolve_guard(allowed: boolean) {
      if (pendingGuardRoute) {
        guardResults.set(pendingGuardRoute, allowed);
        pendingGuardRoute = '';
        version++;
      }
    },
    set_guard_result(routeId: string, allowed: boolean) { guardResults.set(routeId, allowed); version++; },
    is_route_allowed(routeId: string) { return guardResults.get(routeId) ?? true; },
    breadcrumb_count() { return breadcrumbs.length; },
    breadcrumb_label(index: number) { return breadcrumbs[index]?.label ?? ''; },
    breadcrumb_path(index: number) { return breadcrumbs[index]?.path ?? ''; },
    data_version() { return version; },
    reset() {
      currentPath = '/'; currentRouteId = 'home';
      params.clear(); queryParams.clear();
      history.length = 0; history.push('/'); historyIdx = 0;
      pendingGuardRoute = ''; guardResults.clear();
      breadcrumbs.length = 0;
      version++;
    },
  };
}

describe('useRouterEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useRouterEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns RouterHandle with all methods', () => {
    const engine = createMockRouterEngine();
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.push).toBe('function');
    expect(typeof handle.replace).toBe('function');
    expect(typeof handle.back).toBe('function');
    expect(typeof handle.forward).toBe('function');
    expect(typeof handle.setQueryParam).toBe('function');
    expect(typeof handle.clearQueryParams).toBe('function');
    expect(typeof handle.resolveGuard).toBe('function');
    expect(typeof handle.setGuardResult).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getRouteState).toBe('function');
    expect(typeof handle.getParam).toBe('function');
    expect(typeof handle.getQueryParam).toBe('function');
    expect(typeof handle.getBreadcrumbs).toBe('function');
  });

  it('push navigates and notifies', () => {
    const engine = createMockRouterEngine();
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.push('/users'); });
    expect(engine.current_path()).toBe('/users');
    expect(spy).toHaveBeenCalled();
  });

  it('replace updates path and notifies', () => {
    const engine = createMockRouterEngine();
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.replace('/dashboard'); });
    expect(engine.current_path()).toBe('/dashboard');
    expect(spy).toHaveBeenCalled();
  });

  it('back/forward navigate history and notify', () => {
    const engine = createMockRouterEngine();
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    act(() => { handle.push('/a'); handle.push('/b'); });
    expect(engine.current_path()).toBe('/b');
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.back(); });
    expect(engine.current_path()).toBe('/a');
    act(() => { handle.forward(); });
    expect(engine.current_path()).toBe('/b');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('setQueryParam/clearQueryParams and notify', () => {
    const engine = createMockRouterEngine();
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.setQueryParam('page', '2'); });
    expect(engine.query_param('page')).toBe('2');
    act(() => { handle.clearQueryParams(); });
    expect(engine.query_param('page')).toBe('');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('resolveGuard calls engine and notifies', () => {
    const engine = createMockRouterEngine();
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.resolveGuard(true); });
    expect(spy).toHaveBeenCalled();
  });

  it('setGuardResult calls engine and notifies', () => {
    const engine = createMockRouterEngine();
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.setGuardResult('admin', false); });
    expect(engine.is_route_allowed('admin')).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it('reset calls engine and notifies', () => {
    const engine = createMockRouterEngine();
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    act(() => { handle.push('/users'); });
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.reset(); });
    expect(engine.current_path()).toBe('/');
    expect(spy).toHaveBeenCalled();
  });

  it('getRouteState reads all properties', () => {
    const engine = createMockRouterEngine();
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    const state = handle.getRouteState();
    expect(state.path).toBe('/');
    expect(state.canGoBack).toBe(false);
    expect(state.historyLength).toBe(1);
  });

  it('getParam and getQueryParam read from engine', () => {
    const engine = createMockRouterEngine();
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    expect(handle.getParam('id')).toBe('');
    act(() => { handle.setQueryParam('q', 'test'); });
    expect(handle.getQueryParam('q')).toBe('test');
  });

  it('getBreadcrumbs returns empty array when no breadcrumbs', () => {
    const engine = createMockRouterEngine();
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    expect(handle.getBreadcrumbs()).toEqual([]);
  });

  it('getBreadcrumbs returns items when breadcrumbs exist', () => {
    const engine = createMockRouterEngine();
    engine._breadcrumbs.push({ label: 'Home', path: '/' }, { label: 'Users', path: '/users' });
    const { result } = renderHook(() => useRouterEngine(engine));
    const handle = result.current!;
    expect(handle.getBreadcrumbs()).toEqual([
      { label: 'Home', path: '/' },
      { label: 'Users', path: '/users' },
    ]);
  });
});
