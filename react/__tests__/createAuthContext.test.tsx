import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createAuthContext } from '../createAuthContext';
import type { IAuthEngine } from '../../core/interfaces';
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
    access_token() { return accessToken; }, refresh_token() { return refreshToken; },
    is_token_expired(now: number) { return accessExpiry > 0 && now >= accessExpiry; },
    is_refresh_expired(now: number) { return refreshExpiry > 0 && now >= refreshExpiry; },
    token_header() { return accessToken ? `Bearer ${accessToken}` : ''; },
    access_expiry_ms() { return accessExpiry; }, refresh_expiry_ms() { return refreshExpiry; },
    auth_status() { return status; },
    set_authenticating() { status = 1; version++; },
    set_authenticated(a: string, r: string, ae: number, re: number, uj: string) { accessToken = a; refreshToken = r; accessExpiry = ae; refreshExpiry = re; userJson = uj; status = 2; try { const o = JSON.parse(uj); userId = o.id ?? ''; userDisplayName = o.name ?? ''; } catch {} version++; },
    set_error(msg: string) { errorMsg = msg; status = 4; version++; },
    set_refreshing() { status = 3; version++; },
    error_message() { return errorMsg; },
    logout() { accessToken = ''; refreshToken = ''; accessExpiry = 0; refreshExpiry = 0; status = 0; errorMsg = ''; userJson = ''; userId = ''; userDisplayName = ''; permissions.clear(); roles.clear(); version++; },
    refresh_needed(now: number) { return accessExpiry > 0 && now >= accessExpiry; },
    is_authenticated() { return status === 2; },
    session_expires_at() { return Math.min(accessExpiry || Infinity, refreshExpiry || Infinity); },
    set_permissions(json: string) { permissions.clear(); for (const p of JSON.parse(json)) permissions.add(p); version++; },
    has_permission(name: string) { return permissions.has(name); },
    has_role(r: string) { return roles.has(r); },
    permission_count() { return permissions.size; }, role_count() { return roles.size; },
    set_roles(json: string) { roles.clear(); for (const r of JSON.parse(json)) roles.add(r); version++; },
    clear_permissions() { permissions.clear(); roles.clear(); version++; },
    set_user(json: string) { userJson = json; try { const o = JSON.parse(json); userId = o.id ?? ''; userDisplayName = o.name ?? ''; } catch {} version++; },
    user_id() { return userId; }, user_display_name() { return userDisplayName; },
    user_json() { return userJson; }, clear_user() { userJson = ''; userId = ''; userDisplayName = ''; version++; },
    data_version() { return version; },
    reset() { accessToken = ''; refreshToken = ''; accessExpiry = 0; refreshExpiry = 0; status = 0; errorMsg = ''; userJson = ''; userId = ''; userDisplayName = ''; permissions.clear(); roles.clear(); version++; },
  };
}

describe('createAuthContext', () => {
  it('useAuth returns handle from provider', () => {
    const ctx = createAuthContext<IAuthEngine>();
    const engine = createMockAuthEngine();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.AuthProvider engine={engine}>{children}</ctx.AuthProvider>
    );
    const { result } = renderHook(() => ctx.useAuth(), { wrapper });
    expect(result.current).not.toBe(null);
    expect(result.current.engine).toBe(engine);
    expect(typeof result.current.setAuthenticated).toBe('function');
    expect(typeof result.current.logout).toBe('function');
  });

  it('useAuthStatus returns auth state from provider', () => {
    const ctx = createAuthContext<IAuthEngine>();
    const engine = createMockAuthEngine();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.AuthProvider engine={engine}>{children}</ctx.AuthProvider>
    );
    const { result } = renderHook(() => ctx.useAuthStatus(), { wrapper });
    expect(result.current.status).toBe(AuthStatus.Unauthenticated);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('usePermission returns permission state from provider', () => {
    const ctx = createAuthContext<IAuthEngine>();
    const engine = createMockAuthEngine();
    engine.set_permissions('["read"]');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.AuthProvider engine={engine}>{children}</ctx.AuthProvider>
    );
    const { result } = renderHook(() => ctx.usePermission('read'), { wrapper });
    expect(result.current).toEqual({ name: 'read', granted: true });
  });

  it('useRole returns role state from provider', () => {
    const ctx = createAuthContext<IAuthEngine>();
    const engine = createMockAuthEngine();
    engine.set_roles('["admin"]');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.AuthProvider engine={engine}>{children}</ctx.AuthProvider>
    );
    const { result } = renderHook(() => ctx.useRole('admin'), { wrapper });
    expect(result.current).toEqual({ role: 'admin', granted: true });
  });

  it('useAuth throws outside provider', () => {
    const ctx = createAuthContext<IAuthEngine>();
    expect(() => { renderHook(() => ctx.useAuth()); }).toThrow('useAuth must be used within an AuthProvider');
  });

  it('usePermission returns empty state outside provider', () => {
    const ctx = createAuthContext<IAuthEngine>();
    const { result } = renderHook(() => ctx.usePermission('read'));
    expect(result.current).toEqual({ name: '', granted: false });
  });

  it('useRole returns empty state outside provider', () => {
    const ctx = createAuthContext<IAuthEngine>();
    const { result } = renderHook(() => ctx.useRole('admin'));
    expect(result.current).toEqual({ role: '', granted: false });
  });

  it('useAuthStatus returns empty state outside provider', () => {
    const ctx = createAuthContext<IAuthEngine>();
    const { result } = renderHook(() => ctx.useAuthStatus());
    expect(result.current.status).toBe(AuthStatus.Unauthenticated);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('children render correctly', () => {
    const ctx = createAuthContext<IAuthEngine>();
    const engine = createMockAuthEngine();
    const { container } = render(
      <ctx.AuthProvider engine={engine}>
        <div data-testid="child">Hello</div>
      </ctx.AuthProvider>,
    );
    expect(container.textContent).toBe('Hello');
  });

  it('AuthProvider works with null engine', () => {
    const ctx = createAuthContext<IAuthEngine>();
    const { result } = renderHook(() => ctx.usePermission('read'), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.AuthProvider engine={null}>{children}</ctx.AuthProvider>
      ),
    });
    expect(result.current).toEqual({ name: '', granted: false });
  });

  it('mutations via useAuth propagate to usePermission and useAuthStatus', () => {
    const ctx = createAuthContext<IAuthEngine>();
    const engine = createMockAuthEngine();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.AuthProvider engine={engine}>{children}</ctx.AuthProvider>
    );
    const { result } = renderHook(
      () => ({ auth: ctx.useAuth(), perm: ctx.usePermission('write'), status: ctx.useAuthStatus() }),
      { wrapper },
    );
    expect(result.current.perm.granted).toBe(false);
    act(() => { result.current.auth.setPermissions('["write"]'); });
    expect(result.current.perm.granted).toBe(true);
    expect(result.current.status.permissionCount).toBe(1);
  });
});
