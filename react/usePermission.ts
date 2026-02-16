/**
 * usePermission — Per-permission subscription via useWasmSelector.
 *
 * Only this permission's component re-renders when its state changes.
 *
 * Usage:
 *   const { name, granted } = usePermission(handle, 'admin:write');
 *   {granted && <AdminPanel />}
 */

import { useWasmSelector } from './useWasmSelector';
import type { AuthHandle } from './useAuthEngine';
import type { PermissionState } from '../core/types';

const EMPTY_PERMISSION: PermissionState = {
  name: '',
  granted: false,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function usePermission(
  handle: AuthHandle | null,
  name: string,
): PermissionState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_PERMISSION;
      return {
        name,
        granted: handle.engine.has_permission(name),
      };
    },
  );
}
