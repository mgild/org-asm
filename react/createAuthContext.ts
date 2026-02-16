/**
 * createAuthContext — Context factory for sharing an AuthHandle across
 * a component tree without prop drilling.
 *
 * Usage:
 *   // context.ts
 *   export const { AuthProvider, useAuth, useAuthStatus, usePermission, useRole } = createAuthContext<MyAuthEngine>();
 *
 *   // App.tsx
 *   <AuthProvider engine={engine}>
 *     <MyApp />
 *   </AuthProvider>
 *
 *   // Any descendant
 *   const { setAuthenticated, logout } = useAuth();
 *   const { isAuthenticated } = useAuthStatus();
 *   const { granted } = usePermission('admin:write');
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useAuthEngine } from './useAuthEngine';
import { usePermission as usePermissionHook } from './usePermission';
import { useRole as useRoleHook } from './useRole';
import { useAuthState } from './useAuthState';
import type { AuthHandle } from './useAuthEngine';
import type { IAuthEngine } from '../core/interfaces';
import type { AuthState, PermissionState, RoleState } from '../core/types';

export interface AuthProviderProps<E extends IAuthEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface AuthContextValue<E extends IAuthEngine> {
  AuthProvider: (props: AuthProviderProps<E>) => ReactNode;
  useAuth: () => AuthHandle<E>;
  useAuthStatus: () => AuthState;
  usePermission: (name: string) => PermissionState;
  useRole: (role: string) => RoleState;
}

export function createAuthContext<E extends IAuthEngine>(): AuthContextValue<E> {
  const HandleCtx = createContext<AuthHandle<E> | null>(null);

  function useAuth(): AuthHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useAuth must be used within an AuthProvider');
    }
    return ctx;
  }

  function usePermission(name: string): PermissionState {
    const ctx = useContext(HandleCtx);
    return usePermissionHook(ctx, name);
  }

  function useRole(role: string): RoleState {
    const ctx = useContext(HandleCtx);
    return useRoleHook(ctx, role);
  }

  function useAuthStatus(): AuthState {
    const ctx = useContext(HandleCtx);
    return useAuthState(ctx);
  }

  function AuthProvider({ engine, children }: AuthProviderProps<E>): ReactNode {
    const handle = useAuthEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { AuthProvider, useAuth, useAuthStatus, usePermission, useRole };
}
