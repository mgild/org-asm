import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthState } from '../useAuthState';
import { createNotifier } from '../useWasmState';
import type { IAuthEngine } from '../../core/interfaces';
import type { AuthHandle } from '../useAuthEngine';
import type { AuthState } from '../../core/types';
import { AuthStatus } from '../../core/types';

function createMockAuthEngine(): IAuthEngine {
  let version = 0;
  let status = 0;
  let accessToken = '';
  let refreshToken = '';
  let accessExpiry = 0;
  let refreshExpiry = 0;
  let errorMsg = '';
  const permissions = new Set<string>();
  const roles = new Set<string>();
  let userJson = '';
  let userId = '';
  let userDisplayName = '';

  return {
    set_tokens(a: string, r: string, ae: number, re: number) { accessToken = a; refreshToken = r; accessExpiry = ae; refreshExpiry = re; version++; },
    clear_tokens() { accessToken = ''; refreshToken = ''; accessExpiry = 0; refreshExpiry = 0; version++; },
    access_token() { return accessToken; },
    refresh_token() { return refreshToken; },
    is_token_expired(now: number) { return accessExpiry > 0 && now >= accessExpiry; },
    is_refresh_expired(now: number) { return refreshExpiry > 0 && now >= refreshExpiry; },
    token_header() { return accessToken ? `Bearer ${accessToken}` : ''; },
    access_expiry_ms() { return accessExpiry; },
    refresh_expiry_ms() { return refreshExpiry; },
    auth_status() { return status; },
    set_authenticating() { status = 1; version++; },
    set_authenticated(a: string, r: string, ae: number, re: number, uj: string) { accessToken = a; refreshToken = r; accessExpiry = ae; refreshExpiry = re; userJson = uj; status = 2; try { const o = JSON.parse(uj); userId = o.id ?? ''; userDisplayName = o.name ?? ''; } catch {} version++; },
    set_error(msg: string) { errorMsg = msg; status = 4; version++; },
    set_refreshing() { status = 3; version++; },
    error_message() { return errorMsg; },
    logout() { accessToken = ''; refreshToken = ''; accessExpiry = 0; refreshExpiry = 0; status = 0; errorMsg = ''; userJson = ''; userId = ''; userDisplayName = ''; permissions.clear(); roles.clear(); version++; },
    refresh_needed(now: number) { return accessExpiry > 0 && now >= accessExpiry && refreshExpiry > 0 && now < refreshExpiry; },
    is_authenticated() { return status === 2; },
    session_expires_at() { return Math.min(accessExpiry || Infinity, refreshExpiry || Infinity); },
    set_permissions(json: string) { permissions.clear(); for (const p of JSON.parse(json)) permissions.add(p); version++; },
    has_permission(name: string) { return permissions.has(name); },
    has_role(r: string) { return roles.has(r); },
    permission_count() { return permissions.size; },
    role_count() { return roles.size; },
    set_roles(json: string) { roles.clear(); for (const r of JSON.parse(json)) roles.add(r); version++; },
    clear_permissions() { permissions.clear(); roles.clear(); version++; },
    set_user(json: string) { userJson = json; try { const o = JSON.parse(json); userId = o.id ?? ''; userDisplayName = o.name ?? ''; } catch {} version++; },
    user_id() { return userId; },
    user_display_name() { return userDisplayName; },
    user_json() { return userJson; },
    clear_user() { userJson = ''; userId = ''; userDisplayName = ''; version++; },
    data_version() { return version; },
    reset() { accessToken = ''; refreshToken = ''; accessExpiry = 0; refreshExpiry = 0; status = 0; errorMsg = ''; userJson = ''; userId = ''; userDisplayName = ''; permissions.clear(); roles.clear(); version++; },
  };
}

function createHandle(engine: IAuthEngine): AuthHandle {
  const notifier = createNotifier();
  return {
    engine,
    notifier,
    setTokens(a: string, r: string, ae: number, re: number) { engine.set_tokens(a, r, ae, re); notifier.notify(); },
    clearTokens() { engine.clear_tokens(); notifier.notify(); },
    setAuthenticating() { engine.set_authenticating(); notifier.notify(); },
    setAuthenticated(a: string, r: string, ae: number, re: number, uj: string) { engine.set_authenticated(a, r, ae, re, uj); notifier.notify(); },
    setError(msg: string) { engine.set_error(msg); notifier.notify(); },
    setRefreshing() { engine.set_refreshing(); notifier.notify(); },
    logout() { engine.logout(); notifier.notify(); },
    setPermissions(json: string) { engine.set_permissions(json); notifier.notify(); },
    setRoles(json: string) { engine.set_roles(json); notifier.notify(); },
    clearPermissions() { engine.clear_permissions(); notifier.notify(); },
    setUser(json: string) { engine.set_user(json); notifier.notify(); },
    clearUser() { engine.clear_user(); notifier.notify(); },
    reset() { engine.reset(); notifier.notify(); },
    getAuthState(): AuthState { return { status: engine.auth_status() as AuthStatus, isAuthenticated: engine.is_authenticated(), errorMessage: engine.error_message(), accessExpiryMs: engine.access_expiry_ms(), refreshExpiryMs: engine.refresh_expiry_ms(), userId: engine.user_id(), userDisplayName: engine.user_display_name(), permissionCount: engine.permission_count(), roleCount: engine.role_count(), dataVersion: engine.data_version() }; },
    tokenHeader() { return engine.token_header(); },
    accessToken() { return engine.access_token(); },
    refreshToken() { return engine.refresh_token(); },
    isTokenExpired(nowMs?: number) { return engine.is_token_expired(nowMs ?? Date.now()); },
    isRefreshExpired(nowMs?: number) { return engine.is_refresh_expired(nowMs ?? Date.now()); },
    refreshNeeded(nowMs?: number) { return engine.refresh_needed(nowMs ?? Date.now()); },
    isAuthenticated() { return engine.is_authenticated(); },
    hasPermission(name: string) { return engine.has_permission(name); },
    hasRole(role: string) { return engine.has_role(role); },
    userJson() { return engine.user_json(); },
  };
}

describe('useAuthState', () => {
  it('returns empty AuthState when handle is null', () => {
    const { result } = renderHook(() => useAuthState(null));
    expect(result.current).toEqual({
      status: AuthStatus.Unauthenticated,
      isAuthenticated: false,
      errorMessage: '',
      accessExpiryMs: 0,
      refreshExpiryMs: 0,
      userId: '',
      userDisplayName: '',
      permissionCount: 0,
      roleCount: 0,
      dataVersion: 0,
    });
  });

  it('returns correct auth state', () => {
    const engine = createMockAuthEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useAuthState(handle));
    expect(result.current.status).toBe(AuthStatus.Unauthenticated);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('reflects status changes after setAuthenticated', () => {
    const engine = createMockAuthEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useAuthState(handle));
    act(() => { handle.setAuthenticated('tok', 'ref', 1000, 2000, '{"id":"u1","name":"Alice"}'); });
    expect(result.current.status).toBe(AuthStatus.Authenticated);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.userId).toBe('u1');
    expect(result.current.userDisplayName).toBe('Alice');
  });

  it('reflects error state', () => {
    const engine = createMockAuthEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useAuthState(handle));
    act(() => { handle.setError('Auth failed'); });
    expect(result.current.status).toBe(AuthStatus.Error);
    expect(result.current.errorMessage).toBe('Auth failed');
  });

  it('reflects permission and role counts', () => {
    const engine = createMockAuthEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useAuthState(handle));
    act(() => { handle.setPermissions('["read","write"]'); });
    expect(result.current.permissionCount).toBe(2);
    act(() => { handle.setRoles('["admin","user"]'); });
    expect(result.current.roleCount).toBe(2);
  });

  it('updates on notify after reset', () => {
    const engine = createMockAuthEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useAuthState(handle));
    act(() => { handle.setAuthenticated('t', 'r', 100, 200, '{}'); });
    expect(result.current.isAuthenticated).toBe(true);
    act(() => { handle.reset(); });
    expect(result.current.isAuthenticated).toBe(false);
  });
});
