import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useApiEngine } from '../useApiEngine';
import type { IApiEngine } from '../../core/interfaces';

interface MockRequest {
  endpointId: string;
  status: number;
  response: string;
  error: string;
}

function createMockEngine(): IApiEngine & {
  _endpoints: Array<{ id: string; method: string; path: string; params: string }>;
  _requests: Map<number, MockRequest>;
  _cache: Map<string, string>;
  _format: Map<string, number>;
  _cacheTtl: Map<string, number>;
  _nextRequestId: number;
} {
  const endpoints: Array<{ id: string; method: string; path: string; params: string }> = [];
  const requests = new Map<number, MockRequest>();
  const cache = new Map<string, string>();
  const format = new Map<string, number>();
  const cacheTtl = new Map<string, number>();
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
    set_format(endpoint_id: string, fmt: number) {
      format.set(endpoint_id, fmt);
      version++;
    },
    endpoint_format(endpoint_id: string): number {
      return format.get(endpoint_id) ?? 0;
    },
    response_ptr(request_id: number): number {
      return request_id * 1000;
    },
    response_len(request_id: number): number {
      return requests.get(request_id)?.response.length ?? 0;
    },
    build_url(endpoint_id: string, params_json: string): string {
      const ep = endpoints.find(e => e.id === endpoint_id);
      return ep ? `${ep.path}?${params_json}` : '';
    },
    build_body(endpoint_id: string, params_json: string): string {
      return params_json;
    },
    set_cache_ttl(endpoint_id: string, ttl_ms: number) {
      cacheTtl.set(endpoint_id, ttl_ms);
      version++;
    },
    is_cached(endpoint_id: string, params_json: string): boolean {
      return cache.has(`${endpoint_id}:${params_json}`);
    },
    cached_response(endpoint_id: string, params_json: string): string {
      return cache.get(`${endpoint_id}:${params_json}`) ?? '';
    },
    invalidate_cache(endpoint_id: string) {
      for (const key of cache.keys()) {
        if (key.startsWith(`${endpoint_id}:`)) cache.delete(key);
      }
      version++;
    },
    invalidate_all_cache() {
      cache.clear();
      version++;
    },
    active_request_count(): number {
      let count = 0;
      for (const req of requests.values()) {
        if (req.status === 0 || req.status === 1) count++;
      }
      return count;
    },
    request_state(request_id: number): number {
      return requests.get(request_id)?.status ?? 0;
    },
    endpoint_count(): number {
      return endpoints.length;
    },
    endpoint_id(index: number): string {
      return endpoints[index]?.id ?? '';
    },
    endpoint_method(id: string): string {
      return endpoints.find(e => e.id === id)?.method ?? '';
    },
    endpoint_path(id: string): string {
      return endpoints.find(e => e.id === id)?.path ?? '';
    },
    data_version(): number {
      return version;
    },
    reset() {
      endpoints.length = 0;
      requests.clear();
      cache.clear();
      format.clear();
      cacheTtl.clear();
      nextRequestId = 1;
      version++;
    },
    _endpoints: endpoints,
    _requests: requests,
    _cache: cache,
    _format: format,
    _cacheTtl: cacheTtl,
    _nextRequestId: nextRequestId,
  };
}

describe('useApiEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useApiEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns ApiHandle with all methods when engine is provided', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.notifier.subscribe).toBe('function');
    expect(typeof handle.notifier.notify).toBe('function');
    expect(typeof handle.registerEndpoint).toBe('function');
    expect(typeof handle.beginRequest).toBe('function');
    expect(typeof handle.setRequestLoading).toBe('function');
    expect(typeof handle.setRequestSuccess).toBe('function');
    expect(typeof handle.setRequestError).toBe('function');
    expect(typeof handle.cancelRequest).toBe('function');
    expect(typeof handle.setFormat).toBe('function');
    expect(typeof handle.setCacheTtl).toBe('function');
    expect(typeof handle.invalidateCache).toBe('function');
    expect(typeof handle.invalidateAllCache).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getApiState).toBe('function');
    expect(typeof handle.getRequestState).toBe('function');
    expect(typeof handle.responseJson).toBe('function');
    expect(typeof handle.responsePtr).toBe('function');
    expect(typeof handle.responseLen).toBe('function');
    expect(typeof handle.buildUrl).toBe('function');
    expect(typeof handle.buildBody).toBe('function');
    expect(typeof handle.isCached).toBe('function');
    expect(typeof handle.cachedResponse).toBe('function');
    expect(typeof handle.endpointFormat).toBe('function');
  });

  it('registerEndpoint calls engine.register_endpoint and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    expect(engine.endpoint_count()).toBe(1);
    expect(engine.endpoint_method('users')).toBe('GET');
    expect(engine.endpoint_path('users')).toBe('/api/users');
    expect(spy).toHaveBeenCalled();
  });

  it('beginRequest calls engine.begin_request, returns request id, and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    let reqId: number;
    act(() => {
      reqId = handle.beginRequest('users', '{}');
    });

    expect(reqId!).toBe(1);
    expect(engine.request_state(reqId!)).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('setRequestLoading calls engine.set_request_loading and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    let reqId: number;
    act(() => {
      reqId = handle.beginRequest('users', '{}');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setRequestLoading(reqId!);
    });

    expect(engine.request_state(reqId!)).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('setRequestSuccess calls engine.set_request_success and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    let reqId: number;
    act(() => {
      reqId = handle.beginRequest('users', '{}');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setRequestSuccess(reqId!, '{"data":"ok"}');
    });

    expect(engine.request_state(reqId!)).toBe(2);
    expect(engine.response_json(reqId!)).toBe('{"data":"ok"}');
    expect(spy).toHaveBeenCalled();
  });

  it('setRequestError calls engine.set_request_error and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    let reqId: number;
    act(() => {
      reqId = handle.beginRequest('users', '{}');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setRequestError(reqId!, 'Network error');
    });

    expect(engine.request_state(reqId!)).toBe(3);
    expect(engine.response_error(reqId!)).toBe('Network error');
    expect(spy).toHaveBeenCalled();
  });

  it('cancelRequest calls engine.cancel_request and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    let reqId: number;
    act(() => {
      reqId = handle.beginRequest('users', '{}');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.cancelRequest(reqId!);
    });

    expect(engine.request_state(reqId!)).toBe(4);
    expect(spy).toHaveBeenCalled();
  });

  it('setFormat calls engine.set_format and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setFormat('users', 1);
    });

    expect(engine.endpoint_format('users')).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('setCacheTtl calls engine.set_cache_ttl and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setCacheTtl('users', 5000);
    });

    expect(spy).toHaveBeenCalled();
  });

  it('invalidateCache calls engine.invalidate_cache and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.invalidateCache('users');
    });

    expect(spy).toHaveBeenCalled();
  });

  it('invalidateAllCache calls engine.invalidate_all_cache and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.invalidateAllCache();
    });

    expect(spy).toHaveBeenCalled();
  });

  it('reset calls engine.reset and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    // Set some state first
    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
      handle.beginRequest('users', '{}');
    });

    expect(engine.endpoint_count()).toBe(1);

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.reset();
    });

    expect(engine.endpoint_count()).toBe(0);
    expect(engine.active_request_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('getApiState reads all API-level properties', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    const state = handle.getApiState();
    expect(state).toEqual({
      endpointCount: 0,
      activeRequestCount: 0,
      dataVersion: 0,
    });

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    const state2 = handle.getApiState();
    expect(state2.endpointCount).toBe(1);
    expect(state2.dataVersion).toBeGreaterThan(0);
  });

  it('getRequestState reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    let reqId: number;
    act(() => {
      reqId = handle.beginRequest('users', '{}');
    });

    expect(handle.getRequestState(reqId!)).toBe(0);

    act(() => {
      handle.setRequestLoading(reqId!);
    });

    expect(handle.getRequestState(reqId!)).toBe(1);
  });

  it('responseJson reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    let reqId: number;
    act(() => {
      reqId = handle.beginRequest('users', '{}');
    });

    expect(handle.responseJson(reqId!)).toBe('');

    act(() => {
      handle.setRequestSuccess(reqId!, '{"name":"Alice"}');
    });

    expect(handle.responseJson(reqId!)).toBe('{"name":"Alice"}');
  });

  it('responsePtr and responseLen read from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    let reqId: number;
    act(() => {
      reqId = handle.beginRequest('users', '{}');
    });

    expect(handle.responsePtr(reqId!)).toBe(reqId! * 1000);
    expect(handle.responseLen(reqId!)).toBe(0);
  });

  it('buildUrl and buildBody read from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    expect(handle.buildUrl('users', 'page=1')).toBe('/api/users?page=1');
    expect(handle.buildBody('users', '{"name":"Alice"}')).toBe('{"name":"Alice"}');
  });

  it('isCached and cachedResponse read from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    expect(handle.isCached('users', '{}')).toBe(false);
    expect(handle.cachedResponse('users', '{}')).toBe('');

    // Manually populate cache for testing
    engine._cache.set('users:{}', '{"cached":true}');

    expect(handle.isCached('users', '{}')).toBe(true);
    expect(handle.cachedResponse('users', '{}')).toBe('{"cached":true}');
  });

  it('endpointFormat reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useApiEngine(engine));
    const handle = result.current!;

    expect(handle.endpointFormat('users')).toBe(0);

    act(() => {
      handle.setFormat('users', 1);
    });

    expect(handle.endpointFormat('users')).toBe(1);
  });
});
