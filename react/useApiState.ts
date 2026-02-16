/**
 * useApiState — Top-level API state subscription.
 *
 * For loading indicators, endpoint counters, and version tracking.
 * Re-renders only when API-level state (endpointCount, activeRequestCount, etc.) changes.
 *
 * Usage:
 *   const { endpointCount, activeRequestCount, dataVersion } = useApiState(handle);
 *   {activeRequestCount > 0 && <Spinner />}
 */

import { useWasmSelector } from './useWasmSelector';
import type { ApiHandle } from './useApiEngine';
import type { ApiState } from '../core/types';

const EMPTY_STATE: ApiState = {
  endpointCount: 0,
  activeRequestCount: 0,
  dataVersion: 0,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useApiState(
  handle: ApiHandle | null,
): ApiState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
      return {
        endpointCount: engine.endpoint_count(),
        activeRequestCount: engine.active_request_count(),
        dataVersion: engine.data_version(),
      };
    },
  );
}
