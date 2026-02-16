/**
 * useApiEngine — Creates an ApiHandle wrapping a Rust IApiEngine.
 *
 * The handle provides dispatch functions (registerEndpoint, beginRequest,
 * setRequestLoading, setRequestSuccess, setRequestError, cancelRequest, etc.)
 * that mutate the engine and notify subscribers. Per-request and top-level hooks
 * (useRequest, useApiState) subscribe via the notifier to re-render on changes.
 *
 * Usage:
 *   const engine = useMemo(() => new MyApiEngine(), []);
 *   const handle = useApiEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.registerEndpoint('users', 'GET', '/api/users', '[]');
 *   const reqId = handle.beginRequest('users', '{}');
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { IApiEngine } from '../core/interfaces';
import type { ApiState } from '../core/types';

export interface ApiHandle<E extends IApiEngine = IApiEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;
  // Dispatch (mutate + notify)
  registerEndpoint(id: string, method: string, path: string, paramsJson: string): void;
  beginRequest(endpointId: string, paramsJson: string): number;
  setRequestLoading(requestId: number): void;
  setRequestSuccess(requestId: number, responseJson: string): void;
  setRequestError(requestId: number, error: string): void;
  cancelRequest(requestId: number): void;
  setFormat(endpointId: string, format: number): void;
  setCacheTtl(endpointId: string, ttlMs: number): void;
  invalidateCache(endpointId: string): void;
  invalidateAllCache(): void;
  reset(): void;
  // Reads (no notify)
  getApiState(): ApiState;
  getRequestState(requestId: number): number;
  responseJson(requestId: number): string;
  responsePtr(requestId: number): number;
  responseLen(requestId: number): number;
  buildUrl(endpointId: string, paramsJson: string): string;
  buildBody(endpointId: string, paramsJson: string): string;
  isCached(endpointId: string, paramsJson: string): boolean;
  cachedResponse(endpointId: string, paramsJson: string): string;
  endpointFormat(endpointId: string): number;
}

export function useApiEngine<E extends IApiEngine>(
  engine: E | null,
): ApiHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

    return {
      engine,
      notifier,
      registerEndpoint(id: string, method: string, path: string, paramsJson: string): void {
        engine.register_endpoint(id, method, path, paramsJson);
        notifier.notify();
      },
      beginRequest(endpointId: string, paramsJson: string): number {
        const id = engine.begin_request(endpointId, paramsJson);
        notifier.notify();
        return id;
      },
      setRequestLoading(requestId: number): void {
        engine.set_request_loading(requestId);
        notifier.notify();
      },
      setRequestSuccess(requestId: number, responseJson: string): void {
        engine.set_request_success(requestId, responseJson);
        notifier.notify();
      },
      setRequestError(requestId: number, error: string): void {
        engine.set_request_error(requestId, error);
        notifier.notify();
      },
      cancelRequest(requestId: number): void {
        engine.cancel_request(requestId);
        notifier.notify();
      },
      setFormat(endpointId: string, format: number): void {
        engine.set_format(endpointId, format);
        notifier.notify();
      },
      setCacheTtl(endpointId: string, ttlMs: number): void {
        engine.set_cache_ttl(endpointId, ttlMs);
        notifier.notify();
      },
      invalidateCache(endpointId: string): void {
        engine.invalidate_cache(endpointId);
        notifier.notify();
      },
      invalidateAllCache(): void {
        engine.invalidate_all_cache();
        notifier.notify();
      },
      reset(): void {
        engine.reset();
        notifier.notify();
      },
      getApiState(): ApiState {
        return {
          endpointCount: engine.endpoint_count(),
          activeRequestCount: engine.active_request_count(),
          dataVersion: engine.data_version(),
        };
      },
      getRequestState(requestId: number): number {
        return engine.request_state(requestId);
      },
      responseJson(requestId: number): string {
        return engine.response_json(requestId);
      },
      responsePtr(requestId: number): number {
        return engine.response_ptr(requestId);
      },
      responseLen(requestId: number): number {
        return engine.response_len(requestId);
      },
      buildUrl(endpointId: string, paramsJson: string): string {
        return engine.build_url(endpointId, paramsJson);
      },
      buildBody(endpointId: string, paramsJson: string): string {
        return engine.build_body(endpointId, paramsJson);
      },
      isCached(endpointId: string, paramsJson: string): boolean {
        return engine.is_cached(endpointId, paramsJson);
      },
      cachedResponse(endpointId: string, paramsJson: string): string {
        return engine.cached_response(endpointId, paramsJson);
      },
      endpointFormat(endpointId: string): number {
        return engine.endpoint_format(endpointId);
      },
    };
  }, [engine, notifier]);
}
