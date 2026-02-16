/**
 * useRole — Per-role subscription via useWasmSelector.
 *
 * Only this role's component re-renders when its state changes.
 *
 * Usage:
 *   const { role, granted } = useRole(handle, 'admin');
 *   {granted && <AdminBadge />}
 */

import { useWasmSelector } from './useWasmSelector';
import type { AuthHandle } from './useAuthEngine';
import type { RoleState } from '../core/types';

const EMPTY_ROLE: RoleState = {
  role: '',
  granted: false,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useRole(
  handle: AuthHandle | null,
  role: string,
): RoleState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_ROLE;
      return {
        role,
        granted: handle.engine.has_role(role),
      };
    },
  );
}
