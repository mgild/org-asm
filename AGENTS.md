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
| Rust-owned intl state | `useIntlEngine` | `(engine)` | `IntlHandle \| null` |
| Intl-level state (locale, missing) | `useIntlState` | `(handle)` | `IntlState` |
| Per-key translation | `useTranslation` | `(handle, key)` | `TranslationState` |
| Share intl across component tree | `createIntlContext` | `<E>()` | `{ IntlProvider, useIntl, useIntlStatus, useTranslation }` |
| Rust-owned search state | `useSearchEngine` | `(engine)` | `SearchHandle \| null` |
| Search-level state (query, results) | `useSearchState` | `(handle)` | `SearchState` |
| Per-result subscription | `useSearchResult` | `(handle, index)` | `SearchResult` |
| Share search across component tree | `createSearchContext` | `<E>()` | `{ SearchProvider, useSearch, useSearchStatus, useSearchResult }` |
| Rust-owned state machine | `useStateMachineEngine` | `(engine)` | `StateMachineHandle \| null` |
| SM-level state (current, guards) | `useStateMachineState` | `(handle)` | `StateMachineState` |
| Per-state match subscription | `useStateMatch` | `(handle, stateId)` | `StateMatch` |
| Share SM across component tree | `createStateMachineContext` | `<E>()` | `{ StateMachineProvider, useStateMachine, useStateMachineStatus, useStateMatch }` |
| Rust-owned API state | `useApiEngine` | `(engine)` | `ApiHandle \| null` |
| API-level state (endpoints, requests) | `useApiState` | `(handle)` | `ApiState` |
| Per-request subscription | `useRequest` | `(handle, requestId)` | `RequestState` |
| Share API across component tree | `createApiContext` | `<E>()` | `{ ApiProvider, useApi, useApiStatus, useRequest }` |
| Rust-owned virtual scroll state | `useVirtualScrollEngine` | `(engine)` | `VirtualScrollHandle \| null` |
| Scroll-level state (visible range) | `useVirtualScrollState` | `(handle)` | `VirtualScrollState` |
| Per-item scroll subscription | `useVirtualScrollItem` | `(handle, index)` | `VirtualScrollItem` |
| Share virtual scroll across tree | `createVirtualScrollContext` | `<E>()` | `{ VirtualScrollProvider, useVirtualScroll, useVirtualScrollStatus, useVirtualScrollItem }` |
| Rust-owned validation state | `useValidationEngine` | `(engine)` | `ValidationHandle \| null` |
| Validation-level state | `useValidationState` | `(handle)` | `ValidationState` |
| Per-field validation subscription | `useFieldValidation` | `(handle, schemaId, field)` | `FieldValidation` |
| Share validation across tree | `createValidationContext` | `<E>()` | `{ ValidationProvider, useValidation, useValidationStatus, useFieldValidation }` |
| Rust-owned selection state | `useSelectionEngine` | `(engine)` | `SelectionHandle \| null` |
| Selection-level state | `useSelectionState` | `(handle)` | `SelectionState` |
| Per-item selection subscription | `useSelectionItem` | `(handle, id)` | `SelectionItem` |
| Share selection across tree | `createSelectionContext` | `<E>()` | `{ SelectionProvider, useSelection, useSelectionStatus, useSelectionItem }` |
| Rust-owned command palette state | `useCommandPaletteEngine` | `(engine)` | `CommandPaletteHandle \| null` |
| Palette-level state (query, results) | `useCommandPaletteState` | `(handle)` | `CommandPaletteState` |
| Per-result palette subscription | `useCommandPaletteResult` | `(handle, index)` | `CommandPaletteResult` |
| Share palette across tree | `createCommandPaletteContext` | `<E>()` | `{ CommandPaletteProvider, useCommandPalette, useCommandPaletteStatus, useCommandPaletteResult }` |
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

### Rust-owned intl with per-key translation
```ts
const engine = useMemo(() => new MyIntlEngine(), []);
const handle = useIntlEngine(engine);
const { locale, missingKeyCount } = useIntlState(handle);
const { value, missing } = useTranslation(handle, 'greeting.hello');

// Switch locale
handle?.setLocale('es');
handle?.loadMessages(JSON.stringify(esMessages));
```

### Intl context (no prop drilling)
```ts
const { IntlProvider, useIntl, useIntlStatus, useTranslation } = createIntlContext<MyIntlEngine>();
// Wrap: <IntlProvider engine={engine}>...</IntlProvider>
// Read: const { setLocale } = useIntl(); const { locale } = useIntlStatus();
// Translate: const { value, missing } = useTranslation('greeting.hello');
```

### Rust-owned search with faceted filters
```ts
const engine = useMemo(() => new MySearchEngine(), []);
const handle = useSearchEngine(engine);
const { query, resultCount, page, pageCount } = useSearchState(handle);
const { id, exists } = useSearchResult(handle, 0);

handle?.setQuery('laptop');
handle?.addFilter(JSON.stringify({ field: 'category', op: 'eq', value: 'electronics' }));
handle?.setSort('price', 'asc');
handle?.setPage(2);
```

### Search context (no prop drilling)
```ts
const { SearchProvider, useSearch, useSearchStatus, useSearchResult } = createSearchContext<MySearchEngine>();
// Wrap: <SearchProvider engine={engine}>...</SearchProvider>
// Read: const { setQuery, addFilter } = useSearch(); const { resultCount } = useSearchStatus();
// Result: const { id, exists } = useSearchResult(0);
```

### Rust-owned state machine with guards
```ts
const engine = useMemo(() => new MyStateMachineEngine(), []);
const handle = useStateMachineEngine(engine);
const { currentState, pendingGuard } = useStateMachineState(handle);
const { isActive } = useStateMatch(handle, 'review');

handle?.sendEvent('SUBMIT');

// Two-phase guard protocol
useEffect(() => {
  if (!pendingGuard) return;
  checkAuth(pendingGuard).then(ok => handle?.resolveGuard(ok));
}, [pendingGuard]);
```

### State machine context (no prop drilling)
```ts
const { StateMachineProvider, useStateMachine, useStateMachineStatus, useStateMatch } = createStateMachineContext<MyStateMachineEngine>();
// Wrap: <StateMachineProvider engine={engine}>...</StateMachineProvider>
// Read: const { sendEvent } = useStateMachine(); const { currentState } = useStateMachineStatus();
// Match: const { isActive } = useStateMatch('review');
```

### Rust-owned API with request tracking and caching
```ts
const engine = useMemo(() => new MyApiEngine(), []);
const handle = useApiEngine(engine);
const { endpointCount, activeRequestCount } = useApiState(handle);
const { status, error, hasResponse } = useRequest(handle, 'req_1');

// Build URL from registered endpoint
const url = handle?.buildUrl('list_users', JSON.stringify({ page: '1' }));
handle?.beginRequest('req_1', 'list_users');
handle?.setRequestLoading('req_1');
// ... fetch ... then:
handle?.setRequestSuccess('req_1', JSON.stringify(data));
```

### API context (no prop drilling)
```ts
const { ApiProvider, useApi, useApiStatus, useRequest } = createApiContext<MyApiEngine>();
// Wrap: <ApiProvider engine={engine}>...</ApiProvider>
// Read: const { beginRequest, buildUrl } = useApi(); const { activeRequestCount } = useApiStatus();
// Request: const { status, error } = useRequest('req_1');
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
| `useIntlEngine` | Create IntlHandle wrapping Rust IIntlEngine |
| `useIntlState` | Intl-level subscription (locale, missingKeyCount) |
| `useTranslation` | Per-key translation subscription (key, value, missing) |
| `createIntlContext` | Shared intl context factory (Provider + hooks) |
| `useSearchEngine` | Create SearchHandle wrapping Rust ISearchEngine |
| `useSearchState` | Search-level subscription (query, resultCount, page, sort) |
| `useSearchResult` | Per-result subscription (id, exists) |
| `createSearchContext` | Shared search context factory (Provider + hooks) |
| `useStateMachineEngine` | Create StateMachineHandle wrapping Rust IStateMachineEngine |
| `useStateMachineState` | SM-level subscription (currentState, pendingGuard, transitionCount) |
| `useStateMatch` | Per-state match subscription (stateId, isActive, label) |
| `createStateMachineContext` | Shared state machine context factory (Provider + hooks) |
| `useApiEngine` | Create ApiHandle wrapping Rust IApiEngine |
| `useApiState` | API-level subscription (endpointCount, activeRequestCount) |
| `useRequest` | Per-request subscription (requestId, status, error, hasResponse) |
| `createApiContext` | Shared API context factory (Provider + hooks) |
| `useVirtualScrollEngine` | Create VirtualScrollHandle wrapping Rust IVirtualScrollEngine |
| `useVirtualScrollState` | Scroll-level subscription (visibleStart, visibleEnd, totalHeight, scrollOffset) |
| `useVirtualScrollItem` | Per-item subscription (top, height, isVisible) |
| `createVirtualScrollContext` | Shared virtual scroll context factory (Provider + hooks) |
| `useValidationEngine` | Create ValidationHandle wrapping Rust IValidationEngine |
| `useValidationState` | Validation-level subscription (ruleCount, schemaCount, pendingValidationCount) |
| `useFieldValidation` | Per-field validation subscription (errorCount, hasError, firstError) |
| `createValidationContext` | Shared validation context factory (Provider + hooks) |
| `useSelectionEngine` | Create SelectionHandle wrapping Rust ISelectionEngine |
| `useSelectionState` | Selection-level subscription (mode, selectedCount, focusId, anchorId) |
| `useSelectionItem` | Per-item selection subscription (isSelected, isFocused, index) |
| `createSelectionContext` | Shared selection context factory (Provider + hooks) |
| `useCommandPaletteEngine` | Create CommandPaletteHandle wrapping Rust ICommandPaletteEngine |
| `useCommandPaletteState` | Palette-level subscription (commandCount, query, resultCount, page) |
| `useCommandPaletteResult` | Per-result subscription (id, label, category, score, keybinding) |
| `createCommandPaletteContext` | Shared command palette context factory (Provider + hooks) |
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
| `IIntlEngine` | Intl engine contract (set_locale, load_messages, translate, translate_plural) |
| `IntlState` | Intl-level snapshot (locale, fallbackLocale, messageCount, missingKeyCount) |
| `TranslationState` | Per-key translation snapshot (key, value, missing) |
| `ISearchEngine` | Search engine contract (load_items, set_query, add_filter, set_sort, set_page) |
| `FilterOp` | Filter operation enum (eq, neq, gt, gte, lt, lte, contains) |
| `SearchState` | Search-level snapshot (query, resultCount, page, pageSize, sortField, filterCount) |
| `SearchResult` | Per-result snapshot (id, exists) |
| `IStateMachineEngine` | State machine engine contract (add_state, add_transition, send_event, resolve_guard) |
| `StateMachineState` | SM-level snapshot (currentState, pendingGuard, transitionCount, availableEventCount) |
| `StateMatch` | Per-state match snapshot (stateId, isActive, label) |
| `IApiEngine` | API engine contract (register_endpoint, begin_request, set_request_success, build_url) |
| `RequestStatus` | Request status type ('idle' \| 'loading' \| 'success' \| 'error') |
| `ApiFormat` | Response format type ('json' \| 'flatbuffer') |
| `ParamSource` | Parameter source type ('path' \| 'query' \| 'body' \| 'header') |
| `ApiState` | API-level snapshot (endpointCount, activeRequestCount) |
| `RequestState` | Per-request snapshot (requestId, status, error, hasResponse) |
| `IVirtualScrollEngine` | Virtual scroll contract: `set_viewport_height()`, `set_item_count()`, `set_scroll_offset()`, `scroll_to_index()`, `visible_start()`, `visible_end()` |
| `ScrollAlign` | Scroll alignment enum (Start, Center, End) |
| `VirtualScrollState` | Scroll-level snapshot (itemCount, viewportHeight, scrollOffset, visibleStart, visibleEnd, totalHeight) |
| `VirtualScrollItem` | Per-item snapshot (index, top, height, isVisible) |
| `IValidationEngine` | Validation contract: `add_rule()`, `add_schema()`, `validate_json()`, `field_error()`, `start_validation()` |
| `ValidationRuleType` | Rule type enum (Required, Min, Max, MinLength, MaxLength, Pattern, Email, Custom) |
| `CrossFieldRuleType` | Cross-field rule type enum (Equal, NotEqual, GreaterThan, LessThan, Custom) |
| `ValidationState` | Validation-level snapshot (ruleCount, schemaCount, pendingValidationCount) |
| `SchemaValidation` | Per-schema snapshot (schemaId, errorCount, isValid) |
| `FieldValidation` | Per-field snapshot (schemaId, field, errorCount, hasError, firstError) |
| `ISelectionEngine` | Selection contract: `select()`, `deselect()`, `toggle()`, `select_range()`, `move_focus()` |
| `SelectionMode` | Selection mode enum (Single, Multi, Range) |
| `FocusDirection` | Focus direction enum (Up, Down, Left, Right) |
| `SelectionState` | Selection-level snapshot (mode, itemCount, selectedCount, focusId, anchorId) |
| `SelectionItem` | Per-item snapshot (id, isSelected, isFocused, index) |
| `ICommandPaletteEngine` | Command palette contract: `register_command()`, `set_query()`, `resolve_keybinding()`, `mark_executed()` |
| `CommandPaletteState` | Palette-level snapshot (commandCount, query, resultCount, page, lastExecutedId) |
| `CommandPaletteResult` | Per-result snapshot (id, label, category, score, isEnabled, keybinding) |
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
5g. `guides/intl-engine.md` — Intl engine: IIntlEngine, locale management, translation, pluralization
5h. `guides/search-engine.md` — Search engine: ISearchEngine, filters, facets, pagination, lazy recomputation
5i. `guides/statemachine-engine.md` — State machine engine: IStateMachineEngine, transitions, guards, parallel states
5j. `guides/api-engine.md` — API engine: IApiEngine, endpoint normalization, request tracking, caching
5k. `guides/virtualscroll-engine.md` — VirtualScroll engine: IVirtualScrollEngine, visible range, scroll-to, anchoring
5l. `guides/validation-engine.md` — Validation engine: IValidationEngine, rules, schemas, cross-field, async
5m. `guides/selection-engine.md` — Selection engine: ISelectionEngine, multi-select, range-select, keyboard nav
5n. `guides/commandpalette-engine.md` — CommandPalette engine: ICommandPaletteEngine, fuzzy search, keybindings
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
