/**
 * useAuthEngine — Creates an AuthHandle wrapping a Rust IAuthEngine.
 *
 * The handle provides dispatch functions (setTokens, setAuthenticated, logout, etc.)
 * that mutate the engine and notify subscribers. Auth-level and per-permission/role
 * hooks subscribe via the notifier to re-render on changes.
 *
 * Usage:
 *   const engine = useMemo(() => new MyAuthEngine(), []);
 *   const handle = useAuthEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.setAuthenticated(access, refresh, expiryA, expiryR, userJson);
 *   handle.logout();
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { IAuthEngine } from '../core/interfaces';
import type { AuthState, AuthStatus } from '../core/types';

export interface AuthHandle<E extends IAuthEngine = IAuthEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;
  // Dispatch (mutate + notify)
  setTokens(access: string, refresh: string, accessExpiryMs: number, refreshExpiryMs: number): void;
  clearTokens(): void;
  setAuthenticating(): void;
  setAuthenticated(access: string, refresh: string, accessExpiryMs: number, refreshExpiryMs: number, userJson: string): void;
  setError(message: string): void;
  setRefreshing(): void;
  logout(): void;
  setPermissions(json: string): void;
  setRoles(json: string): void;
  clearPermissions(): void;
  setUser(json: string): void;
  clearUser(): void;
  reset(): void;
  // Reads (no notify)
  getAuthState(): AuthState;
  tokenHeader(): string;
  accessToken(): string;
  refreshToken(): string;
  isTokenExpired(nowMs?: number): boolean;
  isRefreshExpired(nowMs?: number): boolean;
  refreshNeeded(nowMs?: number): boolean;
  isAuthenticated(): boolean;
  hasPermission(name: string): boolean;
  hasRole(role: string): boolean;
  userJson(): string;
}

export function useAuthEngine<E extends IAuthEngine>(
  engine: E | null,
): AuthHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

    return {
      engine,
      notifier,
      setTokens(access: string, refresh: string, accessExpiryMs: number, refreshExpiryMs: number): void {
        engine.set_tokens(access, refresh, accessExpiryMs, refreshExpiryMs);
        notifier.notify();
      },
      clearTokens(): void {
        engine.clear_tokens();
        notifier.notify();
      },
      setAuthenticating(): void {
        engine.set_authenticating();
        notifier.notify();
      },
      setAuthenticated(access: string, refresh: string, accessExpiryMs: number, refreshExpiryMs: number, userJson: string): void {
        engine.set_authenticated(access, refresh, accessExpiryMs, refreshExpiryMs, userJson);
        notifier.notify();
      },
      setError(message: string): void {
        engine.set_error(message);
        notifier.notify();
      },
      setRefreshing(): void {
        engine.set_refreshing();
        notifier.notify();
      },
      logout(): void {
        engine.logout();
        notifier.notify();
      },
      setPermissions(json: string): void {
        engine.set_permissions(json);
        notifier.notify();
      },
      setRoles(json: string): void {
        engine.set_roles(json);
        notifier.notify();
      },
      clearPermissions(): void {
        engine.clear_permissions();
        notifier.notify();
      },
      setUser(json: string): void {
        engine.set_user(json);
        notifier.notify();
      },
      clearUser(): void {
        engine.clear_user();
        notifier.notify();
      },
      reset(): void {
        engine.reset();
        notifier.notify();
      },
      getAuthState(): AuthState {
        return {
          status: engine.auth_status() as AuthStatus,
          isAuthenticated: engine.is_authenticated(),
          errorMessage: engine.error_message(),
          accessExpiryMs: engine.access_expiry_ms(),
          refreshExpiryMs: engine.refresh_expiry_ms(),
          userId: engine.user_id(),
          userDisplayName: engine.user_display_name(),
          permissionCount: engine.permission_count(),
          roleCount: engine.role_count(),
          dataVersion: engine.data_version(),
        };
      },
      tokenHeader(): string {
        return engine.token_header();
      },
      accessToken(): string {
        return engine.access_token();
      },
      refreshToken(): string {
        return engine.refresh_token();
      },
      isTokenExpired(nowMs?: number): boolean {
        return engine.is_token_expired(nowMs ?? Date.now());
      },
      isRefreshExpired(nowMs?: number): boolean {
        return engine.is_refresh_expired(nowMs ?? Date.now());
      },
      refreshNeeded(nowMs?: number): boolean {
        return engine.refresh_needed(nowMs ?? Date.now());
      },
      isAuthenticated(): boolean {
        return engine.is_authenticated();
      },
      hasPermission(name: string): boolean {
        return engine.has_permission(name);
      },
      hasRole(role: string): boolean {
        return engine.has_role(role);
      },
      userJson(): string {
        return engine.user_json();
      },
    };
  }, [engine, notifier]);
}
