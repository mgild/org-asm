import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthEngine } from '../useAuthEngine';
import type { IAuthEngine } from '../../core/interfaces';

function createMockAuthEngine(): IAuthEngine & {
  _status: number;
  _accessToken: string;
  _refreshToken: string;
  _accessExpiry: number;
  _refreshExpiry: number;
  _error: string;
  _permissions: Set<string>;
  _roles: Set<string>;
  _userJson: string;
  _userId: string;
  _userDisplayName: string;
} {
  let version = 0;
  const permissions = new Set<string>();
  const roles = new Set<string>();
  let status = 0;
  let accessToken = '';
  let refreshToken = '';
  let accessExpiry = 0;
  let refreshExpiry = 0;
  let error = '';
  let userJson = '';
  let userId = '';
  let userDisplayName = '';

  const engine: ReturnType<typeof createMockAuthEngine> = {
    _status: status,
    _accessToken: accessToken,
    _refreshToken: refreshToken,
    _accessExpiry: accessExpiry,
    _refreshExpiry: refreshExpiry,
    _error: error,
    _permissions: permissions,
    _roles: roles,
    _userJson: userJson,
    _userId: userId,
    _userDisplayName: userDisplayName,
    set_tokens(a: string, r: string, ae: number, re: number) {
      engine._accessToken = a; engine._refreshToken = r;
      engine._accessExpiry = ae; engine._refreshExpiry = re;
      version++;
    },
    clear_tokens() {
      engine._accessToken = ''; engine._refreshToken = '';
      engine._accessExpiry = 0; engine._refreshExpiry = 0;
      version++;
    },
    access_token() { return engine._accessToken; },
    refresh_token() { return engine._refreshToken; },
    is_token_expired(now: number) { return engine._accessExpiry > 0 && now >= engine._accessExpiry; },
    is_refresh_expired(now: number) { return engine._refreshExpiry > 0 && now >= engine._refreshExpiry; },
    token_header() { return engine._accessToken ? `Bearer ${engine._accessToken}` : ''; },
    access_expiry_ms() { return engine._accessExpiry; },
    refresh_expiry_ms() { return engine._refreshExpiry; },
    auth_status() { return engine._status; },
    set_authenticating() { engine._status = 1; version++; },
    set_authenticated(a: string, r: string, ae: number, re: number, uj: string) {
      engine._accessToken = a; engine._refreshToken = r;
      engine._accessExpiry = ae; engine._refreshExpiry = re;
      engine._userJson = uj; engine._status = 2;
      version++;
    },
    set_error(msg: string) { engine._error = msg; engine._status = 4; version++; },
    set_refreshing() { engine._status = 3; version++; },
    error_message() { return engine._error; },
    logout() {
      engine._accessToken = ''; engine._refreshToken = '';
      engine._accessExpiry = 0; engine._refreshExpiry = 0;
      engine._status = 0; engine._error = '';
      engine._userJson = ''; engine._userId = ''; engine._userDisplayName = '';
      permissions.clear(); roles.clear();
      version++;
    },
    refresh_needed(now: number) { return engine._accessExpiry > 0 && now >= engine._accessExpiry && engine._refreshExpiry > 0 && now < engine._refreshExpiry; },
    is_authenticated() { return engine._status === 2; },
    session_expires_at() { return Math.min(engine._accessExpiry || Infinity, engine._refreshExpiry || Infinity); },
    set_permissions(json: string) {
      permissions.clear();
      const arr = JSON.parse(json);
      for (const p of arr) permissions.add(p);
      version++;
    },
    has_permission(name: string) { return permissions.has(name); },
    has_role(r: string) { return roles.has(r); },
    permission_count() { return permissions.size; },
    role_count() { return roles.size; },
    set_roles(json: string) {
      roles.clear();
      const arr = JSON.parse(json);
      for (const r of arr) roles.add(r);
      version++;
    },
    clear_permissions() { permissions.clear(); roles.clear(); version++; },
    set_user(json: string) {
      engine._userJson = json;
      try {
        const obj = JSON.parse(json);
        engine._userId = obj.id ?? '';
        engine._userDisplayName = obj.name ?? '';
      } catch { /* ignore */ }
      version++;
    },
    user_id() { return engine._userId; },
    user_display_name() { return engine._userDisplayName; },
    user_json() { return engine._userJson; },
    clear_user() { engine._userJson = ''; engine._userId = ''; engine._userDisplayName = ''; version++; },
    data_version() { return version; },
    reset() {
      engine._accessToken = ''; engine._refreshToken = '';
      engine._accessExpiry = 0; engine._refreshExpiry = 0;
      engine._status = 0; engine._error = '';
      engine._userJson = ''; engine._userId = ''; engine._userDisplayName = '';
      permissions.clear(); roles.clear();
      version++;
    },
  };
  return engine;
}

describe('useAuthEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useAuthEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns AuthHandle with all methods when engine is provided', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.notifier.subscribe).toBe('function');
    expect(typeof handle.setTokens).toBe('function');
    expect(typeof handle.clearTokens).toBe('function');
    expect(typeof handle.setAuthenticating).toBe('function');
    expect(typeof handle.setAuthenticated).toBe('function');
    expect(typeof handle.setError).toBe('function');
    expect(typeof handle.setRefreshing).toBe('function');
    expect(typeof handle.logout).toBe('function');
    expect(typeof handle.setPermissions).toBe('function');
    expect(typeof handle.setRoles).toBe('function');
    expect(typeof handle.clearPermissions).toBe('function');
    expect(typeof handle.setUser).toBe('function');
    expect(typeof handle.clearUser).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getAuthState).toBe('function');
    expect(typeof handle.tokenHeader).toBe('function');
    expect(typeof handle.accessToken).toBe('function');
    expect(typeof handle.refreshToken).toBe('function');
    expect(typeof handle.isTokenExpired).toBe('function');
    expect(typeof handle.isRefreshExpired).toBe('function');
    expect(typeof handle.refreshNeeded).toBe('function');
    expect(typeof handle.isAuthenticated).toBe('function');
    expect(typeof handle.hasPermission).toBe('function');
    expect(typeof handle.hasRole).toBe('function');
    expect(typeof handle.userJson).toBe('function');
  });

  it('setAuthenticated calls engine and notifies', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.setAuthenticated('tok', 'ref', 1000, 2000, '{"id":"u1","name":"Alice"}'); });
    expect(engine.is_authenticated()).toBe(true);
    expect(engine.access_token()).toBe('tok');
    expect(spy).toHaveBeenCalled();
  });

  it('logout calls engine and notifies', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    act(() => { handle.setAuthenticated('tok', 'ref', 1000, 2000, '{}'); });
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.logout(); });
    expect(engine.is_authenticated()).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it('setTokens calls engine and notifies', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.setTokens('a', 'r', 100, 200); });
    expect(engine.access_token()).toBe('a');
    expect(engine.refresh_token()).toBe('r');
    expect(spy).toHaveBeenCalled();
  });

  it('clearTokens calls engine and notifies', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    act(() => { handle.setTokens('a', 'r', 100, 200); });
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.clearTokens(); });
    expect(engine.access_token()).toBe('');
    expect(spy).toHaveBeenCalled();
  });

  it('setAuthenticating/setRefreshing/setError transition states and notify', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.setAuthenticating(); });
    expect(engine.auth_status()).toBe(1);
    act(() => { handle.setRefreshing(); });
    expect(engine.auth_status()).toBe(3);
    act(() => { handle.setError('fail'); });
    expect(engine.auth_status()).toBe(4);
    expect(engine.error_message()).toBe('fail');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('setPermissions/setRoles/clearPermissions call engine and notify', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.setPermissions('["read","write"]'); });
    expect(engine.has_permission('read')).toBe(true);
    act(() => { handle.setRoles('["admin"]'); });
    expect(engine.has_role('admin')).toBe(true);
    act(() => { handle.clearPermissions(); });
    expect(engine.permission_count()).toBe(0);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('setUser/clearUser call engine and notify', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.setUser('{"id":"u1","name":"Bob"}'); });
    expect(engine.user_id()).toBe('u1');
    act(() => { handle.clearUser(); });
    expect(engine.user_id()).toBe('');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reset calls engine and notifies', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    act(() => { handle.setAuthenticated('t', 'r', 100, 200, '{}'); });
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.reset(); });
    expect(engine.is_authenticated()).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it('getAuthState reads all properties', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    const state = handle.getAuthState();
    expect(state.status).toBe(0);
    expect(state.isAuthenticated).toBe(false);
    expect(state.dataVersion).toBe(0);
  });

  it('read methods work correctly', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    act(() => { handle.setAuthenticated('tok', 'ref', 99999999999, 99999999999, '{"id":"u1"}'); });
    expect(handle.tokenHeader()).toBe('Bearer tok');
    expect(handle.accessToken()).toBe('tok');
    expect(handle.refreshToken()).toBe('ref');
    expect(handle.isTokenExpired(1000)).toBe(false);
    expect(handle.isRefreshExpired(1000)).toBe(false);
    expect(handle.refreshNeeded(1000)).toBe(false);
    expect(handle.isAuthenticated()).toBe(true);
    expect(handle.userJson()).toBe('{"id":"u1"}');
    act(() => { handle.setPermissions('["read"]'); });
    expect(handle.hasPermission('read')).toBe(true);
    expect(handle.hasPermission('write')).toBe(false);
    act(() => { handle.setRoles('["admin"]'); });
    expect(handle.hasRole('admin')).toBe(true);
    expect(handle.hasRole('user')).toBe(false);
  });

  it('isTokenExpired/isRefreshExpired/refreshNeeded default nowMs to Date.now()', () => {
    const engine = createMockAuthEngine();
    const { result } = renderHook(() => useAuthEngine(engine));
    const handle = result.current!;
    // Set access expired (1ms), refresh far future (year ~2099)
    act(() => { handle.setTokens('a', 'r', 1, 4102444800000); });
    expect(handle.isTokenExpired()).toBe(true);
    expect(handle.isRefreshExpired()).toBe(false);
    expect(handle.refreshNeeded()).toBe(true);
  });
});
