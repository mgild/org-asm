import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRole } from '../useRole';
import { createNotifier } from '../useWasmState';
import type { IAuthEngine } from '../../core/interfaces';
import type { AuthHandle } from '../useAuthEngine';
import type { AuthState } from '../../core/types';
import { AuthStatus } from '../../core/types';

function createMockAuthEngine(): IAuthEngine {
  let version = 0;
  const permissions = new Set<string>();
  const roles = new Set<string>();
  return {
    set_tokens() { version++; }, clear_tokens() { version++; },
    access_token() { return ''; }, refresh_token() { return ''; },
    is_token_expired() { return false; }, is_refresh_expired() { return false; },
    token_header() { return ''; }, access_expiry_ms() { return 0; }, refresh_expiry_ms() { return 0; },
    auth_status() { return 0; }, set_authenticating() { version++; },
    set_authenticated() { version++; }, set_error() { version++; }, set_refreshing() { version++; },
    error_message() { return ''; }, logout() { version++; }, refresh_needed() { return false; },
    is_authenticated() { return false; }, session_expires_at() { return 0; },
    set_permissions(json: string) { permissions.clear(); for (const p of JSON.parse(json)) permissions.add(p); version++; },
    has_permission(name: string) { return permissions.has(name); },
    has_role(r: string) { return roles.has(r); },
    permission_count() { return permissions.size; }, role_count() { return roles.size; },
    set_roles(json: string) { roles.clear(); for (const r of JSON.parse(json)) roles.add(r); version++; },
    clear_permissions() { permissions.clear(); roles.clear(); version++; },
    set_user() { version++; }, user_id() { return ''; }, user_display_name() { return ''; },
    user_json() { return ''; }, clear_user() { version++; },
    data_version() { return version; }, reset() { permissions.clear(); roles.clear(); version++; },
  };
}

function createHandle(engine: IAuthEngine): AuthHandle {
  const notifier = createNotifier();
  return {
    engine, notifier,
    setTokens() { notifier.notify(); }, clearTokens() { notifier.notify(); },
    setAuthenticating() { notifier.notify(); }, setAuthenticated() { notifier.notify(); },
    setError() { notifier.notify(); }, setRefreshing() { notifier.notify(); },
    logout() { notifier.notify(); },
    setPermissions(json: string) { engine.set_permissions(json); notifier.notify(); },
    setRoles(json: string) { engine.set_roles(json); notifier.notify(); },
    clearPermissions() { engine.clear_permissions(); notifier.notify(); },
    setUser() { notifier.notify(); }, clearUser() { notifier.notify(); },
    reset() { engine.reset(); notifier.notify(); },
    getAuthState(): AuthState { return { status: 0 as AuthStatus, isAuthenticated: false, errorMessage: '', accessExpiryMs: 0, refreshExpiryMs: 0, userId: '', userDisplayName: '', permissionCount: 0, roleCount: 0, dataVersion: 0 }; },
    tokenHeader() { return ''; }, accessToken() { return ''; }, refreshToken() { return ''; },
    isTokenExpired() { return false; }, isRefreshExpired() { return false; }, refreshNeeded() { return false; },
    isAuthenticated() { return false; }, hasPermission(n: string) { return engine.has_permission(n); },
    hasRole(r: string) { return engine.has_role(r); }, userJson() { return ''; },
  };
}

describe('useRole', () => {
  it('returns empty RoleState when handle is null', () => {
    const { result } = renderHook(() => useRole(null, 'admin'));
    expect(result.current).toEqual({ role: '', granted: false });
  });

  it('returns correct role state', () => {
    const engine = createMockAuthEngine();
    engine.set_roles('["admin","editor"]');
    const handle = createHandle(engine);
    const { result } = renderHook(() => useRole(handle, 'admin'));
    expect(result.current).toEqual({ role: 'admin', granted: true });
  });

  it('returns false for missing role', () => {
    const engine = createMockAuthEngine();
    engine.set_roles('["editor"]');
    const handle = createHandle(engine);
    const { result } = renderHook(() => useRole(handle, 'admin'));
    expect(result.current).toEqual({ role: 'admin', granted: false });
  });

  it('updates on notify', () => {
    const engine = createMockAuthEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useRole(handle, 'admin'));
    expect(result.current.granted).toBe(false);
    act(() => { handle.setRoles('["admin"]'); });
    expect(result.current.granted).toBe(true);
  });
});
