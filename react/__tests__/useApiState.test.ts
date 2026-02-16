import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useApiState } from '../useApiState';
import { createNotifier } from '../useWasmState';
import type { IApiEngine } from '../../core/interfaces';
import type { ApiHandle } from '../useApiEngine';
import type { ApiState } from '../../core/types';

interface MockRequest {
  endpointId: string;
  status: number;
  response: string;
  error: string;
}

function createMockEngine(): IApiEngine & {
  _endpoints: Array<{ id: string; method: string; path: string; params: string }>;
  _requests: Map<number, MockRequest>;
} {
  const endpoints: Array<{ id: string; method: string; path: string; params: string }> = [];
  const requests = new Map<number, MockRequest>();
  const cache = new Map<string, string>();
  const format = new Map<string, number>();
  let nextRequestId = 1;
  let version = 0;

  return {
    register_endpoint(id: string, method: string, path: string, params_json: string) {
      endpoints.push({ id, method, path, params: params_json });
      version++;
    },
    begin_request(endpoint_id: string, params_json: string): number {
      const id = nextRequestId++;
      requests.set(id, { endpointId: endpoint_id, status: 0, response: '', error: '' });
      version++;
      return id;
    },
    set_request_loading(request_id: number) {
      const req = requests.get(request_id);
      if (req) req.status = 1;
      version++;
    },
    set_request_success(request_id: number, response_json: string) {
      const req = requests.get(request_id);
      if (req) { req.status = 2; req.response = response_json; }
      version++;
    },
    set_request_error(request_id: number, error: string) {
      const req = requests.get(request_id);
      if (req) { req.status = 3; req.error = error; }
      version++;
    },
    cancel_request(request_id: number) {
      const req = requests.get(request_id);
      if (req) req.status = 4;
      version++;
    },
    response_json(request_id: number): string {
      return requests.get(request_id)?.response ?? '';
    },
    response_status(request_id: number): number {
      return requests.get(request_id)?.status ?? 0;
    },
    response_error(request_id: number): string {
      return requests.get(request_id)?.error ?? '';
    },
    set_format(endpoint_id: string, fmt: number) { format.set(endpoint_id, fmt); version++; },
    endpoint_format(endpoint_id: string): number { return format.get(endpoint_id) ?? 0; },
    response_ptr(request_id: number): number { return 0; },
    response_len(request_id: number): number { return 0; },
    build_url(endpoint_id: string, params_json: string): string { return ''; },
    build_body(endpoint_id: string, params_json: string): string { return ''; },
    set_cache_ttl(endpoint_id: string, ttl_ms: number) { version++; },
    is_cached(endpoint_id: string, params_json: string): boolean { return cache.has(`${endpoint_id}:${params_json}`); },
    cached_response(endpoint_id: string, params_json: string): string { return cache.get(`${endpoint_id}:${params_json}`) ?? ''; },
    invalidate_cache(endpoint_id: string) { version++; },
    invalidate_all_cache() { cache.clear(); version++; },
    active_request_count(): number {
      let count = 0;
      for (const req of requests.values()) {
        if (req.status === 0 || req.status === 1) count++;
      }
      return count;
    },
    request_state(request_id: number): number { return requests.get(request_id)?.status ?? 0; },
    endpoint_count(): number { return endpoints.length; },
    endpoint_id(index: number): string { return endpoints[index]?.id ?? ''; },
    endpoint_method(id: string): string { return endpoints.find(e => e.id === id)?.method ?? ''; },
    endpoint_path(id: string): string { return endpoints.find(e => e.id === id)?.path ?? ''; },
    data_version(): number { return version; },
    reset() {
      endpoints.length = 0;
      requests.clear();
      cache.clear();
      format.clear();
      nextRequestId = 1;
      version++;
    },
    _endpoints: endpoints,
    _requests: requests,
  };
}

function createHandle(engine: IApiEngine): ApiHandle {
  const notifier = createNotifier();
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
}

describe('useApiState', () => {
  it('returns empty ApiState when handle is null', () => {
    const { result } = renderHook(() => useApiState(null));
    expect(result.current).toEqual({
      endpointCount: 0,
      activeRequestCount: 0,
      dataVersion: 0,
    });
  });

  it('returns correct API state (endpointCount, activeRequestCount, dataVersion)', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useApiState(handle));

    expect(result.current).toEqual({
      endpointCount: 0,
      activeRequestCount: 0,
      dataVersion: 0,
    });
  });

  it('reflects endpointCount after registering an endpoint', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useApiState(handle));
    expect(result.current.endpointCount).toBe(0);

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    expect(result.current.endpointCount).toBe(1);
    expect(result.current.dataVersion).toBeGreaterThan(0);
  });

  it('reflects activeRequestCount after beginning a request', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    const { result } = renderHook(() => useApiState(handle));

    act(() => {
      handle.beginRequest('users', '{}');
    });

    expect(result.current.activeRequestCount).toBe(1);
  });

  it('reflects activeRequestCount decrease after completing a request', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    let reqId: number;
    act(() => {
      reqId = handle.beginRequest('users', '{}');
    });

    const { result } = renderHook(() => useApiState(handle));
    expect(result.current.activeRequestCount).toBe(1);

    act(() => {
      handle.setRequestSuccess(reqId!, '{"data":"ok"}');
    });

    expect(result.current.activeRequestCount).toBe(0);
  });

  it('updates on notify', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useApiState(handle));
    const initialVersion = result.current.dataVersion;

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    expect(result.current.dataVersion).toBeGreaterThan(initialVersion);

    act(() => {
      handle.reset();
    });

    expect(result.current.endpointCount).toBe(0);
    expect(result.current.activeRequestCount).toBe(0);
  });
});
