# AGENTS.md — AI Agent Quick Reference for org-asm

## Core Principle

**All logic that can live in Rust, lives in Rust.** TypeScript handles rendering and I/O only. The Rust WASM engine is the single source of truth for state, validation, computation, and business rules.

## Architecture (MVC)

```
MODEL (Rust WASM)     — State, logic, validation, computation
VIEW (TypeScript)     — DOM/canvas rendering, React hooks, CSS effects
CONTROLLER (TypeScript) — WebSocket/SSE I/O, user input routing, WASM lifecycle
```

## Import Paths

```ts
import { /* types, interfaces */ } from 'org-asm/core';
import { /* hooks */ } from 'org-asm/react';
import { /* pipelines, bridges, workers */ } from 'org-asm/controller';
import { /* animation loops, effect applicators */ } from 'org-asm/view';
import { /* store factories */ } from 'org-asm/model';
```

## Hook Selection

| Scenario | Hook | Signature | Returns |
|----------|------|-----------|---------|
| 60fps animation values | `useFrame` | `(loop, extract, ms?)` | `T \| null` |
| Sync engine call on deps change | `useWasmCall` | `(fn, deps)` | `T` |
| Debounced engine call | `useDebouncedWasmCall` | `(fn, deps, ms)` | `T \| null` |
| React to external state (primitives) | `useWasmState` | `(notifier, getSnapshot)` | `T` |
| React to external state (objects) | `useWasmSelector` | `(notifier, getSnapshot, isEqual?)` | `T` |
| Async operation (Promise) | `useAsyncWasmCall` | `(fn, deps)` | `{ result, loading, error }` |
| Streaming/chunked results | `useWasmStream` | `(fn, deps)` | `{ chunks, done, error }` |
| Full state management (no tick loop) | `useWasmReducer` | `(engine, config)` | `[S, dispatch]` |
| Share engine across component tree | `createWasmContext` | `<E>()` | `{ WasmProvider, useEngine, useNotifier }` |
| Rust-owned form state | `useFormEngine` | `(engine)` | `FormHandle \| null` |
| Per-field reactive state | `useFormField` | `(handle, name)` | `FieldState` |
| Form-level state (submit btn) | `useFormState` | `(handle)` | `FormState` |
| Share form across component tree | `createFormContext` | `<E>()` | `{ FormProvider, useForm, useField, useFormStatus }` |
| Rust-owned table state | `useTableEngine` | `(engine, memory?)` | `TableHandle \| null` |
| Per-row reactive state | `useTableRow` | `(handle, rowIndex)` | `RowState` |
| Per-cell reactive state | `useTableCell` | `(handle, rowIndex, column)` | `CellState` |
| Table-level state (pagination/sort) | `useTableState` | `(handle)` | `TableState` |
| Share table across component tree | `createTableContext` | `<E>()` | `{ TableProvider, useTable, useRow, useCell, useTableStatus }` |
| Rust-owned auth state | `useAuthEngine` | `(engine)` | `AuthHandle \| null` |
| Auth-level state (login status) | `useAuthState` | `(handle)` | `AuthState` |
| Per-permission reactivity | `usePermission` | `(handle, name)` | `PermissionState` |
| Per-role reactivity | `useRole` | `(handle, role)` | `RoleState` |
| Share auth across component tree | `createAuthContext` | `<E>()` | `{ AuthProvider, useAuth, useAuthStatus, usePermission, useRole }` |
| Rust-owned router state | `useRouterEngine` | `(engine)` | `RouterHandle \| null` |
| Route-level state (path/history) | `useRoute` | `(handle)` | `RouteState` |
| Per-route match reactivity | `useRouteMatch` | `(handle, routeId)` | `RouteMatch` |
| Share router across component tree | `createRouterContext` | `<E>()` | `{ RouterProvider, useRouter, useRoute, useRouteMatch }` |
| Rust-owned undo/redo state | `useHistoryEngine` | `(engine)` | `HistoryHandle \| null` |
| History-level state (undo/redo btns) | `useHistoryState` | `(handle)` | `HistoryState` |
| Per-entry undo subscription | `useUndoEntry` | `(handle, index)` | `CommandEntry` |
| Per-entry redo subscription | `useRedoEntry` | `(handle, index)` | `CommandEntry` |
| Share history across component tree | `createHistoryContext` | `<E>()` | `{ HistoryProvider, useHistory, useHistoryStatus, useUndoItem, useRedoItem }` |
| Catch WASM panics | `WasmErrorBoundary` | component | Renders fallback on error |
| WebSocket/SSE connection | `useConnection` | `(config)` | `{ pipeline, connected, state, error, stale }` |
| Off-thread WASM (frame-oriented) | `useWorker` | `(config)` | `{ loop, bridge, ready, error }` |

## Common Patterns

### Wire a WebSocket to an engine
```ts
const { pipeline, connected } = useConnection({ url: 'wss://...' });
const notifier = useMemo(() => createNotifier(), []);

useEffect(() => {
  if (!engine) return;
  pipeline.onMessage(raw => { engine.ingest_message(raw, Date.now()); notifier.notify(); });
}, [pipeline, engine, notifier]);

const balance = useWasmState(notifier, () => engine.balance());
```

### Validate a form field
```ts
const result = useWasmCall(
  () => parseResult(engine.validate_field('price', price)),
  [price],
);
if (!result.ok) showError(result.error);
```

### Offload heavy computation to a worker
```ts
const worker = useMemo(() => new WasmTaskWorker({
  workerUrl: new URL('./compute-worker.ts', import.meta.url),
  wasmUrl: './pkg/engine_bg.wasm',
  engineConstructor: 'Engine',
}), []);

const { result, loading } = useAsyncWasmCall(
  () => worker.call('optimize', { data }),
  [data],
);
```

### Batch rapid-fire mutations
```ts
pipeline.onBinaryMessage(data => {
  notifier.batch(() => {
    for (const msg of parseMessages(data)) {
      engine.ingest(msg);
      notifier.notify(); // suppressed during batch
    }
  }); // single notify fires here
});
```

### Catch WASM panics
```ts
<WasmErrorBoundary
  fallback={({ error, reset }) => (
    <div>
      <p>Engine crashed: {error.message}</p>
      <button onClick={reset}>Restart</button>
    </div>
  )}
  onError={reportToSentry}
  onReset={() => reinitializeEngine()}
>
  <App />
</WasmErrorBoundary>
```

### 60fps rendering with React throttling
```ts
const { memory, ready } = useWasm(() => init());
const engine = useMemo(() => ready ? new Engine() : null, [ready]);
const loop = useAnimationLoop(engine, memory, bytes => Frame.getRootAsFrame(new ByteBuffer(bytes)));
const intensity = useFrame(loop, f => f.intensity(), 100); // 10fps React updates
```

### Reducer for non-animation apps
```ts
const [state, dispatch] = useWasmReducer(engine, {
  getSnapshot: (e) => ({ items: e.get_items(), total: e.total() }),
  dispatch: (e, action) => {
    if (action.type === 'add') e.add_item(action.name, action.price);
    if (action.type === 'remove') e.remove_item(action.id);
  },
});
```

### Rust-owned form with per-field reactivity
```ts
const engine = useMemo(() => new MyFormEngine(), []);
const handle = useFormEngine(engine);
const { value, showError, error } = useFormField(handle, 'email');
const { canSubmit } = useFormState(handle);

<input value={value} onChange={e => handle?.setField('email', e.target.value)}
       onBlur={() => handle?.touchField('email')} />
{showError && <span>{error}</span>}
<button disabled={!canSubmit} onClick={() => handle?.submit()}>Submit</button>
```

### Form context (no prop drilling)
```ts
const { FormProvider, useForm, useField, useFormStatus } = createFormContext<MyFormEngine>();
// Wrap: <FormProvider engine={engine}>...</FormProvider>
// Read: const { setField } = useForm(); const { value } = useField('name');
```

### Rust-owned data table with server-side pagination
```ts
const engine = useMemo(() => new MyTableEngine(), []);
const handle = useTableEngine(engine, wasmMemory);
const { page, pageCount, sortColumn, sortDirection } = useTableState(handle);
const { selected } = useTableRow(handle, rowIndex);
const { value, error, dirty } = useTableCell(handle, rowIndex, 'price');

// Two-phase fetch protocol
useEffect(() => {
  if (!handle?.needsFetch()) return;
  const desc = JSON.parse(handle.queryDescriptor());
  handle.acknowledgeFetch();
  fetchPage(desc).then(({ bytes, total }) => handle.ingestPage(bytes, total));
}, [handle?.needsFetch()]);
```

### Table context (no prop drilling)
```ts
const { TableProvider, useTable, useRow, useCell, useTableStatus } = createTableContext<MyTableEngine>();
// Wrap: <TableProvider engine={engine} wasmMemory={memory}>...</TableProvider>
// Read: const { toggleSort } = useTable(); const { selected } = useRow(0);
```

### Rust-owned auth with per-permission reactivity
```ts
const engine = useMemo(() => new MyAuthEngine(), []);
const handle = useAuthEngine(engine);
const { status, isAuthenticated, userId } = useAuthState(handle);
const { granted } = usePermission(handle, 'admin:write');

// Login flow
handle?.setAuthenticating();
const tokens = await loginApi(credentials);
handle?.setAuthenticated(tokens.access, tokens.refresh, tokens.accessExpiryMs, tokens.refreshExpiryMs, JSON.stringify(user));
```

### Auth context (no prop drilling)
```ts
const { AuthProvider, useAuth, useAuthStatus, usePermission, useRole } = createAuthContext<MyAuthEngine>();
// Wrap: <AuthProvider engine={engine}>...</AuthProvider>
// Read: const { logout } = useAuth(); const { isAuthenticated } = useAuthStatus();
// RBAC: const { granted } = usePermission('admin:write');
```

### Rust-owned router with route guards
```ts
const engine = useMemo(() => new MyRouterEngine(), []);
const handle = useRouterEngine(engine);
const { path, routeId, canGoBack } = useRoute(handle);
const { isMatch, isAllowed } = useRouteMatch(handle, 'dashboard');

handle?.push('/users/123');
handle?.back();

// Two-phase guard protocol
useEffect(() => {
  const guard = handle?.getRouteState().pendingGuard;
  if (!guard) return;
  checkAuth(guard).then(ok => handle?.resolveGuard(ok));
}, [handle?.getRouteState().pendingGuard]);
```

### Router context (no prop drilling)
```ts
const { RouterProvider, useRouter, useRoute, useRouteMatch } = createRouterContext<MyRouterEngine>();
// Wrap: <RouterProvider engine={engine}>...</RouterProvider>
// Read: const { push, back } = useRouter(); const { path } = useRoute();
// Match: const { isMatch } = useRouteMatch('dashboard');
```

### Rust-owned undo/redo with checkpoint tracking
```ts
const engine = useMemo(() => new MyHistoryEngine(), []);
const handle = useHistoryEngine(engine);
const { canUndo, canRedo, hasUnsavedChanges } = useHistoryState(handle);
const { label } = useUndoEntry(handle, 0);

// Push command and undo it
handle?.pushCommand(JSON.stringify({ type: 'setField', field: 'name', prev: 'A', next: 'B' }));
const cmd = handle?.undo(); // returns JSON to reverse
handle?.checkpoint(); // mark save point
```

### History context (no prop drilling)
```ts
const { HistoryProvider, useHistory, useHistoryStatus, useUndoItem, useRedoItem } = createHistoryContext<MyHistoryEngine>();
// Wrap: <HistoryProvider engine={engine}>...</HistoryProvider>
// Read: const { undo, redo } = useHistory(); const { canUndo } = useHistoryStatus();
// Stack: const { label } = useUndoItem(0);
```

### Search with debounce
```ts
const results = useDebouncedWasmCall(
  () => engine.search(query, 20),
  [query],
  200,
);
```

### Object snapshot without re-render churn
```ts
// BAD: re-renders every notify() because new object each time
const book = useWasmState(notifier, () => ({ bid: engine.bid(), ask: engine.ask() }));

// GOOD: shallow equality skips re-render when values unchanged
const book = useWasmSelector(notifier, () => ({ bid: engine.bid(), ask: engine.ask() }));
```

## Anti-Patterns

| Never Do | Instead |
|----------|---------|
| Business logic in TypeScript | Put in Rust engine |
| `useState` for 60fps data | `useFrame` with throttling, or module-level vars |
| Multiple WASM calls per frame | One `tick()` returns everything via FlatBuffer |
| Duplicate state in JS | Engine is single source of truth |
| `useEffect` for validation | `useWasmCall` (sync, no extra render) |
| Store errors in React state | Read from engine via `getSnapshot` |
| `JSON.parse` in WASM | Parse in JS (native C++), pass primitives |
| Allocate in animation loop | Pre-allocate buffers, reuse per frame |
| `useWasmState` with object snapshots | `useWasmSelector` (shallow equality) |
| Raw `notify()` in tight loops | `notifier.batch(() => { ... })` |

## File Map

### Hooks (`react/`)
| Hook | Purpose |
|------|---------|
| `useWasm` | Initialize WASM module |
| `useAnimationLoop` | Create 60fps loop with FlatBuffer adapter |
| `useEngine` | Register engine on shared MultiAnimationLoop |
| `useFrame` | Throttled frame value subscription |
| `useWasmCall` | Sync on-demand WASM call |
| `useDebouncedWasmCall` | Debounced sync WASM call (search/autocomplete) |
| `useWasmState` | Reactive state via useSyncExternalStore |
| `useWasmSelector` | Like useWasmState with structural equality |
| `useAsyncWasmCall` | Async WASM call with loading/error |
| `useWasmStream` | Streaming chunked results |
| `useWasmReducer` | Rust-first useReducer |
| `createWasmContext` | Shared engine context factory |
| `useFormEngine` | Create FormHandle wrapping Rust IFormEngine |
| `useFormField` | Per-field subscription (value, error, showError) |
| `useFormState` | Form-level subscription (isValid, canSubmit) |
| `createFormContext` | Shared form context factory (Provider + hooks) |
| `useTableEngine` | Create TableHandle wrapping Rust ITableEngine |
| `useTableRow` | Per-row subscription (selection state) |
| `useTableCell` | Per-cell subscription (edit value, error, dirty) |
| `useTableState` | Table-level subscription (page, sort, filter, grouping) |
| `createTableContext` | Shared table context factory (Provider + hooks) |
| `useAuthEngine` | Create AuthHandle wrapping Rust IAuthEngine |
| `useAuthState` | Auth-level subscription (status, isAuthenticated, userId) |
| `usePermission` | Per-permission subscription (name, granted) |
| `useRole` | Per-role subscription (role, granted) |
| `createAuthContext` | Shared auth context factory (Provider + hooks) |
| `useRouterEngine` | Create RouterHandle wrapping Rust IRouterEngine |
| `useRoute` | Route-level subscription (path, routeId, canGoBack) |
| `useRouteMatch` | Per-route match subscription (isMatch, isAllowed) |
| `createRouterContext` | Shared router context factory (Provider + hooks) |
| `useHistoryEngine` | Create HistoryHandle wrapping Rust IHistoryEngine |
| `useHistoryState` | History-level subscription (canUndo, canRedo, hasUnsavedChanges) |
| `useUndoEntry` | Per-entry undo subscription (index, label) |
| `useRedoEntry` | Per-entry redo subscription (index, label) |
| `createHistoryContext` | Shared history context factory (Provider + hooks) |
| `WasmErrorBoundary` | Error boundary for WASM panics with reset |
| `useConnection` | WebSocket/SSE with state tracking |
| `useWorker` | Off-main-thread WASM via SharedArrayBuffer |
| `useResponseRegistry` | Command response correlation |
| `useSubscriptionManager` | Auto-replay subscriptions on reconnect |

### Controller (`controller/`)
| Class | Purpose |
|-------|---------|
| `WebSocketPipeline` | Auto-reconnecting WebSocket with backoff, staleness, middleware |
| `SSEPipeline` | Auto-reconnecting SSE (same interface as WebSocket) |
| `WasmBridge` | WASM init lifecycle |
| `WorkerBridge` | Frame-oriented worker (SharedArrayBuffer + tick interval) |
| `WasmTaskWorker` | Request/response worker (Promise-based, one-off computation) |
| `InputController` | DOM events to engine actions |
| `MessageParser` | Route messages to engine methods |
| `CommandSender` | Typed FlatBuffer commands with async responses |
| `ResponseRegistry` | Correlate command responses by ID |
| `SubscriptionManager` | Track + replay subscriptions on reconnect |

### View (`view/`)
| Class | Purpose |
|-------|---------|
| `AnimationLoop` | 60fps rAF loop, single engine |
| `MultiAnimationLoop` | Shared rAF loop, multiple engines |
| `EffectApplicator` | Declarative frame-to-DOM bindings |
| `ChartDataConsumer` | Version-gated chart data sync |
| `ThrottledStateSync` | Bridge 60fps data to React at ~10fps |

### Core (`core/`)
| Export | Purpose |
|--------|---------|
| `WasmResult<T>` | Discriminated union for fallible WASM methods |
| `IFormEngine` | Form engine contract (set_field, submit, validate) |
| `IWizardFormEngine` | Multi-step form extension (step, advance, go_back) |
| `FieldState` | Per-field snapshot (value, error, touched, dirty, showError) |
| `FormState` | Form-level snapshot (isValid, isDirty, canSubmit) |
| `ITableEngine` | Table engine contract (sort, filter, paginate, select, edit, group) |
| `SortDirection` | Sort direction enum (None, Asc, Desc) |
| `RowState` | Per-row snapshot (rowIndex, selected) |
| `CellState` | Per-cell snapshot (value, error, dirty) |
| `TableState` | Table-level snapshot (page, sort, filter, selection, edits, grouping) |
| `IAuthEngine` | Auth engine contract (set_tokens, set_authenticated, logout, has_permission, has_role) |
| `AuthStatus` | Auth status enum (Unauthenticated, Authenticating, Authenticated, Refreshing, Error) |
| `AuthState` | Auth-level snapshot (status, isAuthenticated, userId, permissionCount, roleCount) |
| `PermissionState` | Per-permission snapshot (name, granted) |
| `RoleState` | Per-role snapshot (role, granted) |
| `IRouterEngine` | Router engine contract (navigate, replace, back, forward, is_match, resolve_guard) |
| `RouteState` | Route-level snapshot (path, routeId, canGoBack, canGoForward, pendingGuard) |
| `RouteMatch` | Per-route match snapshot (routeId, isMatch, isAllowed) |
| `BreadcrumbItem` | Breadcrumb entry (label, path) |
| `IHistoryEngine` | History engine contract (push_command, undo, redo, checkpoint, has_unsaved_changes) |
| `HistoryState` | History-level snapshot (canUndo, canRedo, hasUnsavedChanges, isAtCheckpoint) |
| `CommandEntry` | Undo/redo entry snapshot (index, label) |
| `WasmNotifier` | Pub/sub interface for useWasmState |
| `IEngine<F>` | Model contract (tick, addDataPoint, openAction) |
| `IAnimationLoop<F>` | Loop contract (start, stop, addConsumer) |
| `IFrameConsumer<F>` | Per-frame callback with priority ordering |

## Guides (Read Order)

1. `guides/mvc-architecture.md` — Architecture overview, layer responsibilities
2. `guides/wasm-engine-pattern.md` — Engine design, frame buffer, hook mental model
3. `guides/realtime-rendering.md` — 60fps patterns, animation loop, canvas plugins
4. `guides/data-pipeline.md` — WebSocket to engine to React data flow
5. `guides/form-validation.md` — Rust-owned validation, useWasmCall + WasmResult
5b. `guides/form-engine.md` — Full form engine: IFormEngine, per-field reactivity, wizards
5c. `guides/data-table-engine.md` — Data table engine: ITableEngine, pagination, sort, filter, edit, group
5d. `guides/auth-engine.md` — Auth engine: IAuthEngine, token management, RBAC, per-permission reactivity
5e. `guides/router-engine.md` — Router engine: IRouterEngine, navigation, guards, breadcrumbs
5f. `guides/history-engine.md` — History engine: IHistoryEngine, undo/redo, checkpoints, batches
6. `guides/frame-buffer-design.md` — FlatBuffer frame protocol, zero-copy reads
7. `guides/server-engine-pattern.md` — Server-side Rust engine, FlatBuffer broadcast

## Rust Engine Conventions

```rust
#[wasm_bindgen]
impl Engine {
    // Constructor
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine { ... }

    // 60fps hot path — returns FlatBuffer frame
    pub fn tick(&mut self, now_ms: f64) { ... }
    pub fn frame_ptr(&self) -> *const u8 { ... }
    pub fn frame_len(&self) -> usize { ... }

    // Data ingestion — called from WebSocket handler
    pub fn ingest_message(&mut self, raw: &str, now_ms: f64) -> u32 { ... }
    pub fn ingest_frame(&mut self, bytes: &[u8]) { ... }

    // On-demand — called from useWasmCall / useWasmReducer
    pub fn validate_field(&self, field: &str, value: &str) -> String { ... }
    pub fn format_amount(&self, value: f64, decimals: u32) -> String { ... }

    // State snapshots — called from useWasmState / useWasmReducer
    pub fn balance(&self) -> f64 { ... }
    pub fn data_version(&self) -> u32 { ... }

    // Actions — called from InputController / dispatch
    pub fn open_action(&mut self, params: &str, now_ms: f64) { ... }
    pub fn close_action(&mut self, now_ms: f64) -> f64 { ... }
}
```

## Generating Rust Engine Code

When creating a new engine, follow this template:

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct MyEngine {
    // ALL mutable state here — never in JS
    data_version: u32,
}

#[wasm_bindgen]
impl MyEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> MyEngine {
        MyEngine { data_version: 0 }
    }

    // Mutators bump data_version so useWasmState/useWasmSelector re-read
    pub fn set_value(&mut self, v: f64) {
        // ... mutate state ...
        self.data_version += 1;
    }

    // Snapshots are &self (read-only) — called from getSnapshot
    pub fn value(&self) -> f64 { 0.0 }
    pub fn data_version(&self) -> u32 { self.data_version }

    // Validation returns JSON string for WasmResult parsing
    pub fn validate_field(&self, field: &str, value: &str) -> String {
        String::new()
    }
}
```

Key rules:
- `&mut self` methods = mutations (called from dispatch/handlers)
- `&self` methods = snapshots (called from getSnapshot/useWasmCall)
- Bump `data_version` on every state change
- Return simple types (f64, u32, String, bool) -- not structs

## CLI Commands

```bash
npx org-asm init <name>           # Scaffold full-stack project
npx org-asm build                 # flatc + wasm-pack + cargo build
npx org-asm gen-builder <fbs>     # TS builder + sender + hook from FlatBuffers
npx org-asm gen-handler <fbs>     # Rust CommandHandler trait from FlatBuffers
```
