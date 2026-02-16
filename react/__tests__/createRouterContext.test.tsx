import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createRouterContext } from '../createRouterContext';
import type { IRouterEngine } from '../../core/interfaces';

function createMockRouterEngine(): IRouterEngine {
  let version = 0;
  let currentPath = '/';
  let currentRouteId = 'home';
  const queryParams = new Map<string, string>();
  const history: string[] = ['/'];
  let historyIdx = 0;
  const guardResults = new Map<string, boolean>();

  return {
    navigate(path: string) { history.splice(historyIdx + 1); history.push(path); historyIdx++; currentPath = path; currentRouteId = path.replace(/^\//, '') || 'home'; version++; },
    replace(path: string) { history[historyIdx] = path; currentPath = path; currentRouteId = path.replace(/^\//, '') || 'home'; version++; },
    back() { if (historyIdx > 0) { historyIdx--; currentPath = history[historyIdx]; currentRouteId = currentPath.replace(/^\//, '') || 'home'; version++; } },
    forward() { if (historyIdx < history.length - 1) { historyIdx++; currentPath = history[historyIdx]; currentRouteId = currentPath.replace(/^\//, '') || 'home'; version++; } },
    current_path() { return currentPath; }, current_route_id() { return currentRouteId; },
    is_match(routeId: string) { return currentRouteId === routeId; },
    param() { return ''; }, param_count() { return 0; }, param_name() { return ''; },
    query_param(name: string) { return queryParams.get(name) ?? ''; }, query_string() { return ''; },
    set_query_param(name: string, value: string) { queryParams.set(name, value); version++; },
    clear_query_params() { queryParams.clear(); version++; },
    query_param_count() { return queryParams.size; }, query_param_name() { return ''; },
    can_go_back() { return historyIdx > 0; }, can_go_forward() { return historyIdx < history.length - 1; },
    history_length() { return history.length; }, history_index() { return historyIdx; },
    pending_guard() { return ''; }, resolve_guard() { version++; },
    set_guard_result(routeId: string, allowed: boolean) { guardResults.set(routeId, allowed); version++; },
    is_route_allowed(routeId: string) { return guardResults.get(routeId) ?? true; },
    breadcrumb_count() { return 0; }, breadcrumb_label() { return ''; }, breadcrumb_path() { return ''; },
    data_version() { return version; },
    reset() { currentPath = '/'; currentRouteId = 'home'; queryParams.clear(); history.length = 0; history.push('/'); historyIdx = 0; guardResults.clear(); version++; },
  };
}

describe('createRouterContext', () => {
  it('useRouter returns handle from provider', () => {
    const ctx = createRouterContext<IRouterEngine>();
    const engine = createMockRouterEngine();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.RouterProvider engine={engine}>{children}</ctx.RouterProvider>
    );
    const { result } = renderHook(() => ctx.useRouter(), { wrapper });
    expect(result.current.engine).toBe(engine);
    expect(typeof result.current.push).toBe('function');
  });

  it('useRoute returns route state from provider', () => {
    const ctx = createRouterContext<IRouterEngine>();
    const engine = createMockRouterEngine();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.RouterProvider engine={engine}>{children}</ctx.RouterProvider>
    );
    const { result } = renderHook(() => ctx.useRoute(), { wrapper });
    expect(result.current.path).toBe('/');
    expect(result.current.routeId).toBe('home');
  });

  it('useRouteMatch returns match state from provider', () => {
    const ctx = createRouterContext<IRouterEngine>();
    const engine = createMockRouterEngine();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.RouterProvider engine={engine}>{children}</ctx.RouterProvider>
    );
    const { result } = renderHook(() => ctx.useRouteMatch('home'), { wrapper });
    expect(result.current).toEqual({ routeId: 'home', isMatch: true, isAllowed: true });
  });

  it('useRouter throws outside provider', () => {
    const ctx = createRouterContext<IRouterEngine>();
    expect(() => { renderHook(() => ctx.useRouter()); }).toThrow('useRouter must be used within a RouterProvider');
  });

  it('useRoute returns empty state outside provider', () => {
    const ctx = createRouterContext<IRouterEngine>();
    const { result } = renderHook(() => ctx.useRoute());
    expect(result.current.path).toBe('');
  });

  it('useRouteMatch returns empty state outside provider', () => {
    const ctx = createRouterContext<IRouterEngine>();
    const { result } = renderHook(() => ctx.useRouteMatch('home'));
    expect(result.current).toEqual({ routeId: '', isMatch: false, isAllowed: false });
  });

  it('children render correctly', () => {
    const ctx = createRouterContext<IRouterEngine>();
    const engine = createMockRouterEngine();
    const { container } = render(
      <ctx.RouterProvider engine={engine}><div data-testid="child">Hello</div></ctx.RouterProvider>,
    );
    expect(container.textContent).toBe('Hello');
  });

  it('RouterProvider works with null engine', () => {
    const ctx = createRouterContext<IRouterEngine>();
    const { result } = renderHook(() => ctx.useRoute(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.RouterProvider engine={null}>{children}</ctx.RouterProvider>
      ),
    });
    expect(result.current.path).toBe('');
  });

  it('mutations via useRouter propagate to useRoute and useRouteMatch', () => {
    const ctx = createRouterContext<IRouterEngine>();
    const engine = createMockRouterEngine();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.RouterProvider engine={engine}>{children}</ctx.RouterProvider>
    );
    const { result } = renderHook(
      () => ({ router: ctx.useRouter(), route: ctx.useRoute(), match: ctx.useRouteMatch('users') }),
      { wrapper },
    );
    expect(result.current.match.isMatch).toBe(false);
    act(() => { result.current.router.push('/users'); });
    expect(result.current.route.path).toBe('/users');
    expect(result.current.match.isMatch).toBe(true);
  });
});
