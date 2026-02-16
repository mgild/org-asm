# Auth Engine Pattern

Rust-owned auth state machine with token management, RBAC, and session lifecycle. The WASM engine owns ALL auth state -- tokens, status transitions, permissions, roles, user data. TypeScript is a dumb dispatcher that triggers transitions and reads state back.

## When to Use

Use the auth engine when your app has:
- Token-based authentication (JWT access + refresh tokens)
- Role-based access control (RBAC) with permission checks
- Auth state that needs to be consistent across the component tree
- Session lifecycle management (login, refresh, logout, expiry detection)

NOT for simple API-key-only auth or server-rendered session cookies. For those, use plain `useWasmState` with a flat snapshot.

## Quick Start

### 1. Implement IAuthEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/auth-engine-template.rs crates/my-engine/src/auth.rs
```

Customize two things:

1. **Token expiry parsing** in `is_token_expired()` -- decode your JWT claims to extract `exp`
2. **Permission/role model** -- define your app's permission names and role hierarchy

```rust
fn is_token_expired(&self, now_ms: u64) -> bool {
    match &self.access_token {
        Some(token) => decode_jwt_exp(token).map_or(true, |exp| now_ms >= exp),
        None => true,
    }
}
```

### 2. Wire with React Hooks

```tsx
import { useAuthEngine, useAuthState, usePermission, useRole } from 'org-asm/react';

function App() {
  const engine = useMemo(() => new MyAuthEngine(), []);
  const handle = useAuthEngine(engine);

  return (
    <div>
      <AuthStatus handle={handle} />
      <LoginButton handle={handle} />
      <AdminPanel handle={handle} />
    </div>
  );
}

function AuthStatus({ handle }: { handle: AuthHandle | null }) {
  const { status, isAuthenticated } = useAuthState(handle);
  return (
    <div>
      {isAuthenticated ? 'Logged in' : `Status: ${status}`}
    </div>
  );
}

function LoginButton({ handle }: { handle: AuthHandle | null }) {
  const { isAuthenticated } = useAuthState(handle);

  const login = async () => {
    handle?.setAuthenticating();
    try {
      const tokens = await api.login(credentials);
      handle?.setTokens(tokens.access, tokens.refresh);
      handle?.setAuthenticated();
    } catch (e) {
      handle?.setError();
    }
  };

  return isAuthenticated
    ? <button onClick={() => handle?.logout()}>Logout</button>
    : <button onClick={login}>Login</button>;
}

function AdminPanel({ handle }: { handle: AuthHandle | null }) {
  const { granted } = usePermission(handle, 'admin.dashboard');
  if (!granted) return <div>Access denied</div>;
  return <div>Admin content</div>;
}
```

### 3. Context (optional -- no prop drilling)

```tsx
import { createAuthContext } from 'org-asm/react';

const { AuthProvider, useAuth, useAuthStatus, usePermission, useRole } = createAuthContext<MyAuthEngine>();

function App() {
  const engine = useMemo(() => new MyAuthEngine(), []);
  return (
    <AuthProvider engine={engine}>
      <AppRoutes />
    </AuthProvider>
  );
}

function NavBar() {
  const { logout } = useAuth();
  const { isAuthenticated } = useAuthStatus();
  return isAuthenticated ? <button onClick={() => logout()}>Logout</button> : null;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { granted } = usePermission('admin.dashboard');
  const { hasRole } = useRole('admin');
  if (!granted || !hasRole) return <div>Forbidden</div>;
  return <>{children}</>;
}
```

## IAuthEngine Contract

### Token Management

| Method | Type | Description |
|--------|------|-------------|
| `set_tokens(access, refresh)` | `&mut self` | Store access and refresh tokens, bump version |
| `clear_tokens()` | `&mut self` | Remove all tokens, bump version |
| `access_token()` | `&self` | Current access token (empty string if none) |
| `refresh_token()` | `&self` | Current refresh token (empty string if none) |
| `token_header()` | `&self` | `"Bearer <access_token>"` for Authorization header |
| `is_token_expired(now_ms)` | `&self` | Whether access token has expired |
| `is_refresh_expired(now_ms)` | `&self` | Whether refresh token has expired |
| `refresh_needed(now_ms)` | `&self` | Whether a token refresh should be triggered |

### State Machine

| Method | Type | Description |
|--------|------|-------------|
| `set_authenticating()` | `&mut self` | Transition to Authenticating (status=1), bump version |
| `set_authenticated()` | `&mut self` | Transition to Authenticated (status=2), bump version |
| `set_error()` | `&mut self` | Transition to Error (status=4), bump version |
| `set_refreshing()` | `&mut self` | Transition to Refreshing (status=3), bump version |
| `logout()` | `&mut self` | Clear tokens, permissions, roles, user; set Unauthenticated |
| `is_authenticated()` | `&self` | Whether status is Authenticated |

### RBAC

| Method | Type | Description |
|--------|------|-------------|
| `set_permissions(json)` | `&mut self` | Set permissions from JSON array of strings, bump version |
| `clear_permissions()` | `&mut self` | Remove all permissions, bump version |
| `has_permission(name)` | `&self` | Whether permission is granted |
| `set_roles(json)` | `&mut self` | Set roles from JSON array of strings, bump version |
| `has_role(role)` | `&self` | Whether role is assigned |

### User

| Method | Type | Description |
|--------|------|-------------|
| `set_user(json)` | `&mut self` | Store opaque user JSON, bump version |
| `clear_user()` | `&mut self` | Remove user data, bump version |
| `user_json()` | `&self` | Current user data as JSON (empty string if none) |

### State

| Method | Type | Description |
|--------|------|-------------|
| `get_auth_state()` | `&self` | Full snapshot as AuthState |
| `data_version()` | `&self` | Monotonically increasing change counter |
| `reset()` | `&mut self` | Reset all state to defaults (Unauthenticated, no tokens, no user) |

## Auth State Machine

The engine enforces a strict state machine:

```
                    setAuthenticating()
Unauthenticated ──────────────────────► Authenticating
       ▲                                     │
       │                          setAuthenticated() / setError()
       │                                     │
       │  logout()                           ▼
       ├──────────── Authenticated ◄─── (on success)
       │                   │
       │          setRefreshing()
       │                   │
       │                   ▼
       │              Refreshing
       │                   │
       │        setAuthenticated() / setError()
       │                   │
       └───────────────────┘
                         ▲
                    setError()
                         │
                       Error
```

Status values map to the `AuthStatus` enum:

| Value | Name | Description |
|-------|------|-------------|
| 0 | Unauthenticated | No active session |
| 1 | Authenticating | Login in progress |
| 2 | Authenticated | Valid session |
| 3 | Refreshing | Token refresh in progress |
| 4 | Error | Auth failure |

## Token Refresh Flow

The typical refresh pattern:

```ts
useEffect(() => {
  if (!handle) return;
  const interval = setInterval(() => {
    const now = Date.now();
    if (handle.refreshNeeded(now) && !handle.engine.is_refresh_expired(now)) {
      handle.setRefreshing();
      api.refresh(handle.refreshToken())
        .then(tokens => {
          handle.setTokens(tokens.access, tokens.refresh);
          handle.setAuthenticated();
        })
        .catch(() => handle.logout());
    }
  }, 30_000);
  return () => clearInterval(interval);
}, [handle]);
```

## Attaching Tokens to Requests

Use `tokenHeader()` for the Authorization header:

```ts
const header = handle.tokenHeader();
// "Bearer eyJhbGciOi..."
fetch('/api/data', { headers: { Authorization: header } });
```

## Per-Permission Reactivity

Each `usePermission(handle, 'name')` call subscribes via `useWasmSelector` with shallow equality. When permissions change (e.g., after login), only components checking affected permissions re-render.

Similarly, `useRole(handle, 'role')` re-renders only when that specific role's assignment changes.

## Types

### AuthState

```typescript
interface AuthState {
  status: AuthStatus;          // 0-4 enum
  isAuthenticated: boolean;    // status === 2
  hasAccessToken: boolean;     // access_token is not empty
  hasRefreshToken: boolean;    // refresh_token is not empty
  hasUser: boolean;            // user_json is not empty
}
```

### PermissionState

```typescript
interface PermissionState {
  granted: boolean;            // has_permission(name) result
}
```

### RoleState

```typescript
interface RoleState {
  hasRole: boolean;            // has_role(role) result
}
```

## Testing

Mock the engine in tests with a plain JS object:

```typescript
function createMockAuthEngine(): IAuthEngine {
  let _status = 0;
  let _accessToken = '';
  let _refreshToken = '';
  let _userJson = '';
  let _dataVersion = 0;
  const _permissions = new Set<string>();
  const _roles = new Set<string>();

  return {
    set_tokens: (access: string, refresh: string) => {
      _accessToken = access;
      _refreshToken = refresh;
      _dataVersion++;
    },
    clear_tokens: () => { _accessToken = ''; _refreshToken = ''; _dataVersion++; },
    access_token: () => _accessToken,
    refresh_token: () => _refreshToken,
    token_header: () => _accessToken ? `Bearer ${_accessToken}` : '',
    is_token_expired: (_now: number) => false,
    is_refresh_expired: (_now: number) => false,
    refresh_needed: (_now: number) => false,
    set_authenticating: () => { _status = 1; _dataVersion++; },
    set_authenticated: () => { _status = 2; _dataVersion++; },
    set_error: () => { _status = 4; _dataVersion++; },
    set_refreshing: () => { _status = 3; _dataVersion++; },
    logout: () => {
      _status = 0; _accessToken = ''; _refreshToken = '';
      _userJson = ''; _permissions.clear(); _roles.clear();
      _dataVersion++;
    },
    is_authenticated: () => _status === 2,
    set_permissions: (json: string) => {
      _permissions.clear();
      JSON.parse(json).forEach((p: string) => _permissions.add(p));
      _dataVersion++;
    },
    clear_permissions: () => { _permissions.clear(); _dataVersion++; },
    has_permission: (name: string) => _permissions.has(name),
    set_roles: (json: string) => {
      _roles.clear();
      JSON.parse(json).forEach((r: string) => _roles.add(r));
      _dataVersion++;
    },
    has_role: (role: string) => _roles.has(role),
    set_user: (json: string) => { _userJson = json; _dataVersion++; },
    clear_user: () => { _userJson = ''; _dataVersion++; },
    user_json: () => _userJson,
    data_version: () => _dataVersion,
    reset: () => { _status = 0; _dataVersion++; },
  } as IAuthEngine;
}
```

Use `renderHook` from `@testing-library/react` to test hooks in isolation. The auth engine hooks follow the same testing patterns as `useWasmState` and `useWasmSelector`.
