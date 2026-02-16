/**
 * useRouteMatch — Per-route match subscription via useWasmSelector.
 *
 * Only this route's component re-renders when its match state changes.
 *
 * Usage:
 *   const { isMatch, isAllowed } = useRouteMatch(handle, 'user-profile');
 *   {isMatch && isAllowed && <UserProfile />}
 */

import { useWasmSelector } from './useWasmSelector';
import type { RouterHandle } from './useRouterEngine';
import type { RouteMatch } from '../core/types';

const EMPTY_MATCH: RouteMatch = {
  routeId: '',
  isMatch: false,
  isAllowed: false,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useRouteMatch(
  handle: RouterHandle | null,
  routeId: string,
): RouteMatch {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_MATCH;
      return {
        routeId,
        isMatch: handle.engine.is_match(routeId),
        isAllowed: handle.engine.is_route_allowed(routeId),
      };
    },
  );
}
