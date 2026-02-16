/**
 * useRoute — Route-level state subscription.
 *
 * For navigation bars, route indicators, and history controls.
 * Re-renders only when route-level state changes.
 *
 * Usage:
 *   const { path, routeId, canGoBack } = useRoute(handle);
 *   <button disabled={!canGoBack} onClick={() => handle?.back()}>Back</button>
 */

import { useWasmSelector } from './useWasmSelector';
import type { RouterHandle } from './useRouterEngine';
import type { RouteState } from '../core/types';

const EMPTY_STATE: RouteState = {
  path: '',
  routeId: '',
  queryString: '',
  canGoBack: false,
  canGoForward: false,
  historyLength: 0,
  historyIndex: 0,
  pendingGuard: '',
  dataVersion: 0,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useRoute(
  handle: RouterHandle | null,
): RouteState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
      return {
        path: engine.current_path(),
        routeId: engine.current_route_id(),
        queryString: engine.query_string(),
        canGoBack: engine.can_go_back(),
        canGoForward: engine.can_go_forward(),
        historyLength: engine.history_length(),
        historyIndex: engine.history_index(),
        pendingGuard: engine.pending_guard(),
        dataVersion: engine.data_version(),
      };
    },
  );
}
