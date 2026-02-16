# API Engine Pattern

Rust-owned API normalization layer with endpoint registration, parameter splitting, request tracking, caching, and FlatBuffer response support. The WASM engine owns ALL API state -- endpoint definitions, request lifecycle, cache entries, response formats. TypeScript is a dumb dispatcher that triggers requests and reads response state back.

## When to Use

Use the API engine when your app has:
- Multiple API endpoints with normalized request/response patterns
- Request lifecycle tracking (loading, success, error states)
- Client-side response caching with TTL-based invalidation
- Mixed response formats (JSON + FlatBuffer binary)

NOT for simple single-endpoint fetch calls or GraphQL. For those, use `useAsyncWasmCall` or a dedicated GraphQL client.

## Quick Start

### 1. Implement IApiEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/api-engine-template.rs crates/my-engine/src/api.rs
```

Customize two things:

1. **Endpoint definitions** -- register your API endpoints with URL patterns and param sources
2. **Cache policy** -- configure TTL and cache key generation per endpoint

```rust
fn init_endpoints(&mut self) {
    self.register_endpoint("list_users", "/api/users", "GET", &[
        ("page", ParamSource::Query),
        ("limit", ParamSource::Query),
    ]);
    self.register_endpoint("get_user", "/api/users/{id}", "GET", &[
        ("id", ParamSource::Path),
    ]);
    self.register_endpoint("create_user", "/api/users", "POST", &[
        ("name", ParamSource::Body),
        ("email", ParamSource::Body),
    ]);
    self.set_cache_ttl("list_users", 30_000); // 30s cache
    self.set_format("get_user", ApiFormat::FlatBuffer);
}
```

### 2. Wire with React Hooks

```tsx
import { useApiEngine, useApiState, useRequest } from 'org-asm/react';

function App() {
  const engine = useMemo(() => new MyApiEngine(), []);
  const handle = useApiEngine(engine);

  return (
    <div>
      <ApiStatus handle={handle} />
      <UserList handle={handle} />
    </div>
  );
}

function ApiStatus({ handle }: { handle: ApiHandle | null }) {
  const { endpointCount, activeRequestCount } = useApiState(handle);
  return (
    <div>
      <span>Endpoints: {endpointCount}</span>
      <span>Active: {activeRequestCount}</span>
    </div>
  );
}

function UserList({ handle }: { handle: ApiHandle | null }) {
  const [requestId, setRequestId] = useState<string>('');
  const request = useRequest(handle, requestId);

  const fetchUsers = async () => {
    // Check cache first
    const params = JSON.stringify({ page: '1', limit: '20' });
    if (handle?.isCached('list_users', params)) {
      const cached = handle.cachedResponse('list_users', params);
      setUsers(JSON.parse(cached));
      return;
    }

    // Build URL from engine
    const url = handle?.buildUrl('list_users', params) ?? '';
    const id = `list_users_${Date.now()}`;
    setRequestId(id);
    handle?.beginRequest(id, 'list_users');
    handle?.setRequestLoading(id);

    try {
      const response = await fetch(url);
      const data = await response.json();
      handle?.setRequestSuccess(id, JSON.stringify(data));
    } catch (e) {
      handle?.setRequestError(id, (e as Error).message);
    }
  };

  return (
    <div>
      <button onClick={fetchUsers}>Load Users</button>
      {request?.status === 'loading' && <div>Loading...</div>}
      {request?.status === 'error' && <div>Error: {request.error}</div>}
      {request?.status === 'success' && <div>Loaded!</div>}
    </div>
  );
}

function UserDetail({ handle, userId }: { handle: ApiHandle | null; userId: string }) {
  const requestId = `get_user_${userId}`;
  const request = useRequest(handle, requestId);

  useEffect(() => {
    if (!handle) return;
    const params = JSON.stringify({ id: userId });
    const url = handle.buildUrl('get_user', params);
    handle.beginRequest(requestId, 'get_user');
    handle.setRequestLoading(requestId);

    fetch(url)
      .then(r => {
        const format = handle.endpointFormat('get_user');
        if (format === 'flatbuffer') return r.arrayBuffer();
        return r.json().then(d => JSON.stringify(d));
      })
      .then(data => handle.setRequestSuccess(requestId, data as string))
      .catch(e => handle.setRequestError(requestId, e.message));
  }, [handle, userId]);

  return request?.hasResponse ? <div>User loaded</div> : <div>Loading...</div>;
}
```

### 3. Context (optional -- no prop drilling)

```tsx
import { createApiContext } from 'org-asm/react';

const { ApiProvider, useApi, useApiStatus, useRequest } = createApiContext<MyApiEngine>();

function App() {
  const engine = useMemo(() => new MyApiEngine(), []);
  return (
    <ApiProvider engine={engine}>
      <Dashboard />
    </ApiProvider>
  );
}

function RequestCount() {
  const { activeRequestCount } = useApiStatus();
  return activeRequestCount > 0 ? <span>Loading ({activeRequestCount})...</span> : null;
}

function RequestDetail({ requestId }: { requestId: string }) {
  const { status, error, hasResponse } = useRequest(requestId);
  return (
    <div>
      Status: {status}
      {error && <span> - {error}</span>}
      {hasResponse && <span> (has data)</span>}
    </div>
  );
}

function ApiActions() {
  const { beginRequest, setRequestLoading, buildUrl } = useApi();
  // Use dispatch methods from context
}
```

## IApiEngine Contract

### Endpoint Registration

| Method | Type | Description |
|--------|------|-------------|
| `register_endpoint(id, url_pattern, method, params)` | `&mut self` | Register an endpoint with URL pattern and param sources, bump version |
| `set_format(endpoint_id, format)` | `&mut self` | Set response format for an endpoint (JSON or FlatBuffer), bump version |
| `set_cache_ttl(endpoint_id, ttl_ms)` | `&mut self` | Set cache TTL in milliseconds for an endpoint, bump version |

### Request Lifecycle

| Method | Type | Description |
|--------|------|-------------|
| `begin_request(request_id, endpoint_id)` | `&mut self` | Start tracking a request, bump version |
| `set_request_loading(request_id)` | `&mut self` | Mark request as loading, bump version |
| `set_request_success(request_id, response)` | `&mut self` | Mark request as success with response data, cache if configured, bump version |
| `set_request_error(request_id, error)` | `&mut self` | Mark request as error with message, bump version |
| `cancel_request(request_id)` | `&mut self` | Cancel a request and remove from tracking, bump version |

### URL/Body Building

| Method | Type | Description |
|--------|------|-------------|
| `build_url(endpoint_id, params_json)` | `&self` | Build full URL with path and query params interpolated |
| `build_body(endpoint_id, params_json)` | `&self` | Build request body from body-sourced params as JSON |

### Cache

| Method | Type | Description |
|--------|------|-------------|
| `is_cached(endpoint_id, params_json)` | `&self` | Whether a valid (non-expired) cache entry exists |
| `cached_response(endpoint_id, params_json)` | `&self` | Get cached response data (empty if not cached) |
| `invalidate_cache(endpoint_id)` | `&mut self` | Remove all cache entries for an endpoint, bump version |
| `invalidate_all_cache()` | `&mut self` | Remove all cache entries, bump version |

### Response Reads

| Method | Type | Description |
|--------|------|-------------|
| `get_api_state()` | `&self` | Full snapshot as ApiState |
| `get_request_state(request_id)` | `&self` | Snapshot of a specific request |
| `response_json(request_id)` | `&self` | Response data as JSON string (empty if no response) |
| `response_ptr(request_id)` | `&self` | Pointer to FlatBuffer response in WASM memory (0 if none) |
| `response_len(request_id)` | `&self` | Length of FlatBuffer response bytes (0 if none) |
| `endpoint_format(endpoint_id)` | `&self` | Response format for an endpoint ("json" or "flatbuffer") |

### State

| Method | Type | Description |
|--------|------|-------------|
| `data_version()` | `&self` | Monotonically increasing change counter |
| `reset()` | `&mut self` | Reset all state (clear endpoints, requests, cache) |

## Parameter Sources

Parameters are split by source to build URLs and request bodies correctly:

| Source | Description | Example |
|--------|-------------|---------|
| `Path` | Interpolated into URL pattern | `/api/users/{id}` -> `/api/users/42` |
| `Query` | Appended as query string | `/api/users?page=1&limit=20` |
| `Body` | Included in request body JSON | `{ "name": "Alice", "email": "alice@example.com" }` |
| `Header` | Set as request header | `X-Custom: value` |

```ts
// Engine builds URL and body separately
const params = JSON.stringify({ id: '42', page: '1', name: 'Alice' });
const url = handle?.buildUrl('update_user', params);   // /api/users/42?page=1
const body = handle?.buildBody('update_user', params);  // {"name":"Alice"}
```

## Response Formats

The engine supports two response formats:

### JSON (default)

Response stored as JSON string, read via `responseJson()`:

```ts
const json = handle?.responseJson(requestId);
if (json) {
  const data = JSON.parse(json);
}
```

### FlatBuffer

Response stored as binary bytes in WASM memory, read zero-copy via `responsePtr()` / `responseLen()`:

```ts
const ptr = handle?.responsePtr(requestId);
const len = handle?.responseLen(requestId);
if (ptr && len && wasmMemory) {
  const bytes = new Uint8Array(wasmMemory.buffer, ptr, len);
  const response = MyResponse.getRootAsMyResponse(new ByteBuffer(bytes));
}
```

## Caching

Cache entries are keyed by `(endpoint_id, params_json)` and expire after the configured TTL:

```ts
// Check cache before making a request
const params = JSON.stringify({ page: '1' });
if (handle?.isCached('list_users', params)) {
  const cached = handle.cachedResponse('list_users', params);
  return JSON.parse(cached);
}

// Cache is automatically populated on setRequestSuccess
// when the endpoint has a TTL configured

// Invalidate when data changes
handle?.invalidateCache('list_users');
```

## Types

### ApiState

```typescript
interface ApiState {
  endpointCount: number;       // Number of registered endpoints
  activeRequestCount: number;  // Number of in-flight requests
}
```

### RequestState

```typescript
interface RequestState {
  requestId: string;           // Unique request identifier
  status: RequestStatus;       // 'idle' | 'loading' | 'success' | 'error'
  error: string;               // Error message (empty if no error)
  hasResponse: boolean;        // Whether response data is available
}
```

### RequestStatus

```typescript
type RequestStatus = 'idle' | 'loading' | 'success' | 'error';
```

### ApiFormat

```typescript
type ApiFormat = 'json' | 'flatbuffer';
```

### ParamSource

```typescript
type ParamSource = 'path' | 'query' | 'body' | 'header';
```

## Testing

Mock the engine in tests with a plain JS object:

```typescript
function createMockApiEngine(): IApiEngine {
  let _dataVersion = 0;
  const _endpoints = new Map<string, { urlPattern: string; method: string; format: string; ttl: number }>();
  const _requests = new Map<string, { endpointId: string; status: string; error: string; response: string }>();
  const _cache = new Map<string, { response: string; expiresAt: number }>();

  return {
    register_endpoint: (id: string, urlPattern: string, method: string) => {
      _endpoints.set(id, { urlPattern, method, format: 'json', ttl: 0 });
      _dataVersion++;
    },
    set_format: (endpointId: string, format: string) => {
      const ep = _endpoints.get(endpointId);
      if (ep) ep.format = format;
      _dataVersion++;
    },
    set_cache_ttl: (endpointId: string, ttlMs: number) => {
      const ep = _endpoints.get(endpointId);
      if (ep) ep.ttl = ttlMs;
      _dataVersion++;
    },
    begin_request: (requestId: string, endpointId: string) => {
      _requests.set(requestId, { endpointId, status: 'idle', error: '', response: '' });
      _dataVersion++;
    },
    set_request_loading: (requestId: string) => {
      const r = _requests.get(requestId);
      if (r) r.status = 'loading';
      _dataVersion++;
    },
    set_request_success: (requestId: string, response: string) => {
      const r = _requests.get(requestId);
      if (r) { r.status = 'success'; r.response = response; }
      _dataVersion++;
    },
    set_request_error: (requestId: string, error: string) => {
      const r = _requests.get(requestId);
      if (r) { r.status = 'error'; r.error = error; }
      _dataVersion++;
    },
    cancel_request: (requestId: string) => { _requests.delete(requestId); _dataVersion++; },
    build_url: (endpointId: string, paramsJson: string) => {
      const ep = _endpoints.get(endpointId);
      if (!ep) return '';
      const params = JSON.parse(paramsJson);
      let url = ep.urlPattern;
      Object.entries(params).forEach(([k, v]) => { url = url.replace(`{${k}}`, v as string); });
      return url;
    },
    build_body: (_endpointId: string, paramsJson: string) => paramsJson,
    is_cached: (endpointId: string, paramsJson: string) => {
      const key = `${endpointId}:${paramsJson}`;
      const entry = _cache.get(key);
      return entry ? Date.now() < entry.expiresAt : false;
    },
    cached_response: (endpointId: string, paramsJson: string) => {
      const key = `${endpointId}:${paramsJson}`;
      return _cache.get(key)?.response ?? '';
    },
    invalidate_cache: (endpointId: string) => {
      for (const key of _cache.keys()) {
        if (key.startsWith(endpointId + ':')) _cache.delete(key);
      }
      _dataVersion++;
    },
    invalidate_all_cache: () => { _cache.clear(); _dataVersion++; },
    get_api_state: () => ({
      endpointCount: _endpoints.size,
      activeRequestCount: [..._requests.values()].filter(r => r.status === 'loading').length,
    }),
    get_request_state: (requestId: string) => {
      const r = _requests.get(requestId);
      if (!r) return { requestId, status: 'idle', error: '', hasResponse: false };
      return { requestId, status: r.status, error: r.error, hasResponse: r.response !== '' };
    },
    response_json: (requestId: string) => _requests.get(requestId)?.response ?? '',
    response_ptr: (_requestId: string) => 0,
    response_len: (_requestId: string) => 0,
    endpoint_format: (endpointId: string) => _endpoints.get(endpointId)?.format ?? 'json',
    data_version: () => _dataVersion,
    reset: () => {
      _endpoints.clear(); _requests.clear(); _cache.clear();
      _dataVersion++;
    },
  } as IApiEngine;
}
```

Use `renderHook` from `@testing-library/react` to test hooks in isolation. The API engine hooks follow the same testing patterns as `useWasmState` and `useWasmSelector`.
