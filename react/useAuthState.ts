/**
 * useAuthState — Auth-level state subscription.
 *
 * For login buttons, auth status indicators, and session tracking.
 * Re-renders only when auth-level state changes.
 *
 * Usage:
 *   const { status, isAuthenticated, userId } = useAuthState(handle);
 *   {isAuthenticated ? <Dashboard /> : <LoginForm />}
 */

import { useWasmSelector } from './useWasmSelector';
import type { AuthHandle } from './useAuthEngine';
import type { AuthState } from '../core/types';
import { AuthStatus } from '../core/types';

const EMPTY_STATE: AuthState = {
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
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useAuthState(
  handle: AuthHandle | null,
): AuthState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
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
  );
}
