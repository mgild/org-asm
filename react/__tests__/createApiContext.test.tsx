import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createApiContext } from '../createApiContext';
import { RequestStatus } from '../../core/types';
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
    _cache: cache,
    _format: format,
  };
}

describe('createApiContext', () => {
  it('useApi returns handle from provider', () => {
    const ctx = createApiContext<IApiEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.ApiProvider engine={engine}>
        {children}
      </ctx.ApiProvider>
    );

    const { result } = renderHook(() => ctx.useApi(), { wrapper });
    const handle = result.current;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
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
    expect(typeof handle.buildUrl).toBe('function');
    expect(typeof handle.buildBody).toBe('function');
    expect(typeof handle.isCached).toBe('function');
    expect(typeof handle.cachedResponse).toBe('function');
    expect(typeof handle.endpointFormat).toBe('function');
  });

  it('useApiStatus returns API state from provider', () => {
    const ctx = createApiContext<IApiEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.ApiProvider engine={engine}>
        {children}
      </ctx.ApiProvider>
    );

    const { result } = renderHook(() => ctx.useApiStatus(), { wrapper });

    expect(result.current).toEqual({
      endpointCount: 0,
      activeRequestCount: 0,
      dataVersion: 0,
    });
  });

  it('useRequest returns request state from provider', () => {
    const ctx = createApiContext<IApiEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.ApiProvider engine={engine}>
        {children}
      </ctx.ApiProvider>
    );

    const { result } = renderHook(() => ctx.useRequest(0), { wrapper });

    expect(result.current).toEqual({
      requestId: 0,
      endpointId: '',
      status: RequestStatus.Idle,
      error: '',
      hasResponse: false,
    });
  });

  it('useApi throws outside provider', () => {
    const ctx = createApiContext<IApiEngine>();

    expect(() => {
      renderHook(() => ctx.useApi());
    }).toThrow('useApi must be used within an ApiProvider');
  });

  it('useApiStatus returns empty state outside provider (null handle)', () => {
    const ctx = createApiContext<IApiEngine>();

    const { result } = renderHook(() => ctx.useApiStatus());

    expect(result.current).toEqual({
      endpointCount: 0,
      activeRequestCount: 0,
      dataVersion: 0,
    });
  });

  it('useRequest returns empty state outside provider (null handle)', () => {
    const ctx = createApiContext<IApiEngine>();

    const { result } = renderHook(() => ctx.useRequest(42));

    expect(result.current).toEqual({
      requestId: 0,
      endpointId: '',
      status: RequestStatus.Idle,
      error: '',
      hasResponse: false,
    });
  });

  it('children render correctly', () => {
    const ctx = createApiContext<IApiEngine>();
    const engine = createMockEngine();

    const { container } = render(
      <ctx.ApiProvider engine={engine}>
        <div data-testid="child">Hello from child</div>
      </ctx.ApiProvider>,
    );

    expect(container.textContent).toBe('Hello from child');
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('ApiProvider works with null engine', () => {
    const ctx = createApiContext<IApiEngine>();

    const { result } = renderHook(() => ctx.useApiStatus(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.ApiProvider engine={null}>
          {children}
        </ctx.ApiProvider>
      ),
    });

    expect(result.current).toEqual({
      endpointCount: 0,
      activeRequestCount: 0,
      dataVersion: 0,
    });
  });

  it('mutations via useApi propagate to useApiStatus and useRequest', () => {
    const ctx = createApiContext<IApiEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.ApiProvider engine={engine}>
        {children}
      </ctx.ApiProvider>
    );

    // First register an endpoint and begin a request
    const { result: apiResult } = renderHook(() => ctx.useApi(), { wrapper });

    act(() => {
      apiResult.current.registerEndpoint('users', 'GET', '/api/users', '[]');
    });

    let reqId: number;
    act(() => {
      reqId = apiResult.current.beginRequest('users', '{}');
    });

    const { result } = renderHook(
      () => ({
        api: ctx.useApi(),
        status: ctx.useApiStatus(),
        request: ctx.useRequest(reqId!),
      }),
      { wrapper },
    );

    expect(result.current.status.endpointCount).toBe(1);
    expect(result.current.status.activeRequestCount).toBe(1);
    expect(result.current.request.status).toBe(RequestStatus.Idle);

    act(() => {
      result.current.api.setRequestSuccess(reqId!, '{"data":"ok"}');
    });

    expect(result.current.status.activeRequestCount).toBe(0);
    expect(result.current.request.status).toBe(RequestStatus.Success);
    expect(result.current.request.hasResponse).toBe(true);
  });
});
