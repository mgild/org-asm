# Router Engine Pattern

Rust-owned client-side routing with segment matching, guards, breadcrumbs, and history management. The WASM engine owns ALL route state -- path, params, query, guard lifecycle, breadcrumb trail. TypeScript is a dumb renderer that dispatches navigation events and reads route state back.

## When to Use

Use the router engine when your app has:
- Client-side routing with dynamic segments (`/users/:id/posts/:postId`)
- Navigation guards (auth checks, unsaved changes confirmation)
- Breadcrumb trails derived from matched routes
- Route state that needs to be consistent across the component tree

NOT for static multi-page apps or server-side routing. For those, use your framework's built-in router.

## Quick Start

### 1. Implement IRouterEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/router-engine-template.rs crates/my-engine/src/router.rs
```

Customize two things:

1. **Route table** in `init_routes()` -- register your path patterns and guard requirements
2. **Guard logic** -- define which routes need auth or other preconditions

```rust
fn init_routes(&mut self) {
    self.add_route("/", "home", &[]);
    self.add_route("/login", "login", &[]);
    self.add_route("/dashboard", "dashboard", &["auth"]);
    self.add_route("/users/:id", "user_detail", &["auth"]);
    self.add_route("/users/:id/posts/:postId", "user_post", &["auth"]);
    self.add_route("/admin", "admin", &["auth", "admin_role"]);
}
```

### 2. Wire with React Hooks

```tsx
import { useRouterEngine, useRoute, useRouteMatch } from 'org-asm/react';

function App() {
  const engine = useMemo(() => new MyRouterEngine(), []);
  const handle = useRouterEngine(engine);

  // Sync browser URL → engine on popstate
  useEffect(() => {
    const onPop = () => handle?.push(window.location.pathname + window.location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [handle]);

  return (
    <div>
      <NavBar handle={handle} />
      <Breadcrumbs handle={handle} />
      <RouterOutlet handle={handle} />
    </div>
  );
}

function NavBar({ handle }: { handle: RouterHandle | null }) {
  return (
    <nav>
      <a href="#" onClick={e => { e.preventDefault(); handle?.push('/'); }}>Home</a>
      <a href="#" onClick={e => { e.preventDefault(); handle?.push('/dashboard'); }}>Dashboard</a>
    </nav>
  );
}

function Breadcrumbs({ handle }: { handle: RouterHandle | null }) {
  const crumbs = handle?.getBreadcrumbs() ?? [];
  return (
    <nav>
      {crumbs.map((crumb, i) => (
        <span key={i}>
          {i > 0 && ' / '}
          <a href="#" onClick={e => { e.preventDefault(); handle?.push(crumb.path); }}>
            {crumb.label}
          </a>
        </span>
      ))}
    </nav>
  );
}

function RouterOutlet({ handle }: { handle: RouterHandle | null }) {
  const { routeName, pendingGuard } = useRoute(handle);

  // Resolve guards
  useEffect(() => {
    if (!pendingGuard) return;
    const allowed = checkGuard(pendingGuard); // your guard logic
    handle?.setGuardResult(allowed);
  }, [pendingGuard]);

  switch (routeName) {
    case 'home': return <HomePage />;
    case 'dashboard': return <DashboardPage />;
    case 'user_detail': return <UserDetailPage handle={handle} />;
    default: return <NotFoundPage />;
  }
}

function UserDetailPage({ handle }: { handle: RouterHandle | null }) {
  const match = useRouteMatch(handle);
  const userId = match?.params?.id;
  return <div>User: {userId}</div>;
}
```

### 3. Context (optional -- no prop drilling)

```tsx
import { createRouterContext } from 'org-asm/react';

const { RouterProvider, useRouter, useRoute, useRouteMatch } = createRouterContext<MyRouterEngine>();

function App() {
  const engine = useMemo(() => new MyRouterEngine(), []);
  return (
    <RouterProvider engine={engine}>
      <AppShell />
    </RouterProvider>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const { push } = useRouter();
  return (
    <a href="#" onClick={e => { e.preventDefault(); push(to); }}>
      {children}
    </a>
  );
}

function CurrentRoute() {
  const { routeName, path } = useRoute();
  return <div>Current: {routeName} ({path})</div>;
}

function RouteParams() {
  const match = useRouteMatch();
  return <pre>{JSON.stringify(match?.params)}</pre>;
}
```

## IRouterEngine Contract

### Navigation

| Method | Type | Description |
|--------|------|-------------|
| `push(path)` | `&mut self` | Navigate to path, add to history stack, match route, bump version |
| `replace(path)` | `&mut self` | Navigate to path, replace current history entry, bump version |
| `back()` | `&mut self` | Go back one entry in history, bump version |
| `forward()` | `&mut self` | Go forward one entry in history, bump version |

### Route Matching

| Method | Type | Description |
|--------|------|-------------|
| `get_route_state()` | `&self` | Full snapshot as RouteState |
| `get_param(name)` | `&self` | Dynamic segment value (empty if not matched) |
| `get_query_param(name)` | `&self` | Query string parameter value (empty if not found) |

### Query Parameters

| Method | Type | Description |
|--------|------|-------------|
| `set_query_param(name, value)` | `&mut self` | Set/update a query parameter, bump version |
| `clear_query_params()` | `&mut self` | Remove all query parameters, bump version |

### Breadcrumbs

| Method | Type | Description |
|--------|------|-------------|
| `get_breadcrumbs()` | `&self` | JSON array of BreadcrumbItem from root to current route |

### Guards

| Method | Type | Description |
|--------|------|-------------|
| `resolve_guard(name)` | `&self` | Get the pending guard name (empty if none) |
| `set_guard_result(allowed)` | `&mut self` | Resolve the pending guard, proceed or redirect, bump version |

### State

| Method | Type | Description |
|--------|------|-------------|
| `data_version()` | `&self` | Monotonically increasing change counter |
| `reset()` | `&mut self` | Reset all state to defaults (root path, empty history) |

## Guard Protocol (Two-Phase Navigation)

Guards use a two-phase protocol similar to the table engine's fetch protocol:

1. **User navigates** (`push('/dashboard')`) -- engine matches route, finds `auth` guard
2. **Engine sets** `pending_guard = "auth"` and bumps `data_version`
3. **TypeScript reads** `pendingGuard` from `useRoute()` and runs the check
4. **TypeScript calls** `setGuardResult(true)` or `setGuardResult(false)`
5. **Engine either** completes the navigation or redirects to a fallback route

```ts
// The canonical guard resolution loop
useEffect(() => {
  if (!pendingGuard) return;

  if (pendingGuard === 'auth') {
    const isLoggedIn = authHandle?.isAuthenticated() ?? false;
    handle?.setGuardResult(isLoggedIn);
  } else if (pendingGuard === 'admin_role') {
    const isAdmin = authHandle?.hasRole('admin') ?? false;
    handle?.setGuardResult(isAdmin);
  }
}, [pendingGuard]);
```

When `setGuardResult(false)` is called, the engine reverts to the previous route. The guard-failed route is never committed to history.

## Route Matching

The engine matches URL segments against registered patterns:

```
Pattern: /users/:id/posts/:postId
URL:     /users/42/posts/7

Params: { id: "42", postId: "7" }
```

Matching rules:
- Static segments must match exactly
- `:param` segments capture any non-empty value
- Unmatched URLs produce an empty `routeName` (use for 404 pages)
- Query strings are parsed separately (`/search?q=hello` -> query param `q` = `hello`)

## Breadcrumbs

Breadcrumbs are derived from the matched route's ancestor chain:

```
Route: /users/:id/posts/:postId
Breadcrumbs: [
  { label: "Home", path: "/" },
  { label: "Users", path: "/users" },
  { label: "User 42", path: "/users/42" },
  { label: "Post 7", path: "/users/42/posts/7" }
]
```

Labels are customizable in the route table registration. Dynamic segments are interpolated into labels at match time.

## Types

### RouteState

```typescript
interface RouteState {
  path: string;                // Current full path
  routeName: string;           // Matched route name (empty if no match)
  pendingGuard: string;        // Guard awaiting resolution (empty if none)
  historyLength: number;       // Number of entries in history stack
  historyIndex: number;        // Current position in history stack
}
```

### RouteMatch

```typescript
interface RouteMatch {
  routeName: string;           // Matched route name
  params: Record<string, string>;  // Dynamic segment values
  query: Record<string, string>;   // Query string parameters
}
```

### BreadcrumbItem

```typescript
interface BreadcrumbItem {
  label: string;               // Display label
  path: string;                // Navigation path
}
```

## Syncing with Browser History

The engine manages its own history stack. To keep the browser URL bar in sync:

```ts
// Engine → Browser: after every navigation
useEffect(() => {
  const state = handle?.getRouteState();
  if (!state) return;
  window.history.pushState(null, '', state.path);
}, [handle?.engine.data_version()]);

// Browser → Engine: on back/forward button
useEffect(() => {
  const onPop = () => handle?.push(window.location.pathname + window.location.search);
  window.addEventListener('popstate', onPop);
  return () => window.removeEventListener('popstate', onPop);
}, [handle]);
```

## Testing

Mock the engine in tests with a plain JS object:

```typescript
function createMockRouterEngine(): IRouterEngine {
  let _path = '/';
  let _routeName = 'home';
  let _pendingGuard = '';
  let _dataVersion = 0;
  const _params = new Map<string, string>();
  const _query = new Map<string, string>();
  const _history: string[] = ['/'];
  let _historyIndex = 0;

  return {
    push: (path: string) => {
      _history.splice(_historyIndex + 1);
      _history.push(path);
      _historyIndex = _history.length - 1;
      _path = path;
      _dataVersion++;
    },
    replace: (path: string) => {
      _history[_historyIndex] = path;
      _path = path;
      _dataVersion++;
    },
    back: () => {
      if (_historyIndex > 0) {
        _historyIndex--;
        _path = _history[_historyIndex];
        _dataVersion++;
      }
    },
    forward: () => {
      if (_historyIndex < _history.length - 1) {
        _historyIndex++;
        _path = _history[_historyIndex];
        _dataVersion++;
      }
    },
    get_route_state: () => ({
      path: _path,
      routeName: _routeName,
      pendingGuard: _pendingGuard,
      historyLength: _history.length,
      historyIndex: _historyIndex,
    }),
    get_param: (name: string) => _params.get(name) ?? '',
    get_query_param: (name: string) => _query.get(name) ?? '',
    set_query_param: (name: string, value: string) => { _query.set(name, value); _dataVersion++; },
    clear_query_params: () => { _query.clear(); _dataVersion++; },
    get_breadcrumbs: () => JSON.stringify([{ label: 'Home', path: '/' }]),
    resolve_guard: () => _pendingGuard,
    set_guard_result: (allowed: boolean) => {
      if (!allowed) { _path = _history[Math.max(0, _historyIndex - 1)]; }
      _pendingGuard = '';
      _dataVersion++;
    },
    data_version: () => _dataVersion,
    reset: () => { _path = '/'; _routeName = 'home'; _dataVersion++; },
  } as IRouterEngine;
}
```

Use `renderHook` from `@testing-library/react` to test hooks in isolation. The router engine hooks follow the same testing patterns as `useWasmState` and `useWasmSelector`.
