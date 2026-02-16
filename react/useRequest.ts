/**
 * useRequest — Per-request state subscription via useWasmSelector.
 *
 * Only this request's component re-renders when its state changes.
 * Other requests remain untouched thanks to structural equality.
 *
 * Usage:
 *   const { status, error, hasResponse } = useRequest(handle, requestId);
 *   if (status === RequestStatus.Loading) return <Spinner />;
 *   if (status === RequestStatus.Error) return <ErrorMsg>{error}</ErrorMsg>;
 */

import { useWasmSelector } from './useWasmSelector';
import { RequestStatus } from '../core/types';
import type { ApiHandle } from './useApiEngine';
import type { RequestState } from '../core/types';

const EMPTY_REQUEST: RequestState = {
  requestId: 0,
  endpointId: '',
  status: RequestStatus.Idle,
  error: '',
  hasResponse: false,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useRequest(
  handle: ApiHandle | null,
  requestId: number,
): RequestState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_REQUEST;
      const { engine } = handle;
      const status: RequestStatus = engine.request_state(requestId);
      const error = engine.response_error(requestId);
      const hasResponse = engine.response_json(requestId) !== '';
      return {
        requestId,
        endpointId: '',
        status,
        error,
        hasResponse,
      };
    },
  );
}
