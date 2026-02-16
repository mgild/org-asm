# orgASM 💦🍆

**Organized Assembly for Structured Machines.**

A Rust-first MVC framework for React applications. All logic that can live in Rust, lives in Rust — state management, validation, data processing, real-time computation, business rules. TypeScript is reduced to a thin rendering and I/O layer.

---

## Problem

Web applications scatter logic across TypeScript: state management, validation, data transforms, real-time processing, business rules — all reimplemented in a language without types you can trust, ownership semantics, or predictable performance. The result: fragile state, subtle bugs, duplicated logic between client and server, and performance cliffs under load.

For real-time apps (trading, dashboards, simulations), it gets worse: 60fps computation collides with React's render model, producing ad-hoc `useRef` / `requestAnimationFrame` / manual DOM hacks with no separation of concerns.

## Solution

orgASM moves everything except rendering and I/O into Rust:

- **Model** (Rust/WASM): Owns all application state, business logic, validation, and computation. Exposes state to JS via FlatBuffer frames — zero-copy reads from WASM linear memory. One boundary crossing instead of N getter calls.
- **View** (TypeScript + React hooks): Thin rendering layer. Reads state from the Model, writes to DOM/canvas/charts. No business logic, no derived state, no validation.
- **Controller** (TypeScript): Routes external data (WebSocket, SSE) and user input to the Model. Handles connection lifecycle, message parsing, and bidirectional commands.
- **Server** (Rust/Axum): Optional upstream engine sharing the same Rust crate as the client. Ingests data, processes it, broadcasts FlatBuffer frames over binary WebSocket.

The Rust Model handles state, validation, data transforms, and real-time computation. TypeScript handles what it's good at: DOM access, browser APIs, and React rendering. For real-time paths, the FlatBuffer protocol makes **60 boundary crossings/sec instead of 2,340** (at 60fps with 39 fields).

## Architecture

```
┌──────────────────────────────────────┐
│   SERVER ENGINE (Rust/Axum)          │
│   Optional upstream data processor   │
│   ServerEngine trait → ingest/tick   │
│   FlatBuffer serialize → broadcast   │
│   CommandHandler ← client commands   │
└──────────────────┬───────────────────┘
                   │ Binary WebSocket (FlatBuffer bytes)
┌──────────────────▼───────────────────┐
│          MODEL (Rust WASM)           │
│  ALL state, logic, validation        │
│  tick(now_ms) → FlatBuffer frame     │
│  ingest_frame(&[u8]) ← server bytes │
│  Business rules, data transforms     │
│  Shared crate for domain types       │
└──────────────────┬───────────────────┘
                   │ FlatBuffer frames / method calls
┌──────────────────▼───────────────────┐
│          VIEW (TypeScript + React)   │
│  AnimationLoop    → orchestrates     │
│  EffectApplicator → DOM/CSS writes   │
│  ChartDataConsumer → chart library   │
│  useFrame()       → React hook       │
│  useConnection()  → WS state hook    │
└──────────────────┬───────────────────┘
                   │ user events / commands
┌──────────────────▼───────────────────┐
│       CONTROLLER (TypeScript)        │
│  WebSocketPipeline → data ingestion  │
│  BinaryFrameParser → binary frames   │
│  CommandSender     → typed commands  │
│  InputController   → user actions    │
│  WasmBridge        → WASM lifecycle  │
└──────────────────────────────────────┘
```

### What Lives Where

| Rust (Model) | TypeScript (View + Controller) |
|---|---|
| Application state | DOM rendering |
| Business rules & validation | React components & hooks |
| Data transforms & aggregation | Browser API access |
| Real-time computation (tick) | WebSocket / SSE I/O |
| Message parsing (serde) | User input routing |
| Derived values & formatting | CSS / canvas writes |

### Data Flow Speeds

```
60fps:      Engine.tick() → Canvas/DOM             (module-level, zero React)
~10fps:     useFrame() / ThrottledStateSync        (React re-renders)
on-demand:  useWasmCall() / useWasmState()         (validation, events, derived values)
async:      useAsyncWasmCall()                     (worker offload, wasm-bindgen-futures)
streaming:  useWasmStream()                        (large dataset processing, progress)
~1fps:      Config changes → Engine.set_*()        (user settings)
```

Real-time paths use the frame buffer and direct DOM writes — React never sees 60fps data. Throttled snapshots reach React at ~10fps. On-demand calls (validation, computation) return results directly.

---

## Which Hook?

| I want to... | Use | Returns |
|---|---|---|
| Read WASM state at 60fps | `useFrame` | `T \| null` |
| Call engine on deps change | `useWasmCall` | `T` |
| Debounce engine calls | `useDebouncedWasmCall` | `T \| null` |
| React to external mutations | `useWasmState` | `T` |
| ...same but with objects | `useWasmSelector` | `T` |
| Run async WASM operation | `useAsyncWasmCall` | `{ result, loading, error }` |
| Stream chunked results | `useWasmStream` | `{ chunks, done, error }` |
| Full state management | `useWasmReducer` | `[S, dispatch]` |
| Share engine across tree | `createWasmContext` | `{ WasmProvider, useEngine, useNotifier }` |
| Rust-owned form state | `useFormEngine` | `FormHandle \| null` |
| Per-field form reactivity | `useFormField` | `FieldState` |
| Form-level state | `useFormState` | `FormState` |
| Share form across tree | `createFormContext` | `{ FormProvider, useForm, useField, useFormStatus }` |
| Rust-owned table state | `useTableEngine` | `TableHandle \| null` |
| Per-row table reactivity | `useTableRow` | `RowState` |
| Per-cell table reactivity | `useTableCell` | `CellState` |
| Table-level state | `useTableState` | `TableState` |
| Share table across tree | `createTableContext` | `{ TableProvider, useTable, useRow, useCell, useTableStatus }` |
| Rust-owned auth state | `useAuthEngine` | `AuthHandle \| null` |
| Auth-level state | `useAuthState` | `AuthState` |
| Per-permission reactivity | `usePermission` | `PermissionState` |
| Per-role reactivity | `useRole` | `RoleState` |
| Share auth across tree | `createAuthContext` | `{ AuthProvider, useAuth, useAuthStatus, usePermission, useRole }` |
| Rust-owned router state | `useRouterEngine` | `RouterHandle \| null` |
| Route-level state | `useRoute` | `RouteState` |
| Per-route match reactivity | `useRouteMatch` | `RouteMatch` |
| Share router across tree | `createRouterContext` | `{ RouterProvider, useRouter, useRoute, useRouteMatch }` |
| Rust-owned undo/redo state | `useHistoryEngine` | `HistoryHandle \| null` |
| History-level state | `useHistoryState` | `HistoryState` |
| Per-entry undo subscription | `useUndoEntry` | `CommandEntry` |
| Per-entry redo subscription | `useRedoEntry` | `CommandEntry` |
| Share history across tree | `createHistoryContext` | `{ HistoryProvider, useHistory, useHistoryStatus, useUndoItem, useRedoItem }` |
| Rust-owned intl state | `useIntlEngine` | `IntlHandle \| null` |
| Intl-level state | `useIntlState` | `IntlState` |
| Per-key translation | `useTranslation` | `TranslationState` |
| Share intl across tree | `createIntlContext` | `{ IntlProvider, useIntl, useIntlStatus, useTranslation }` |
| Rust-owned search state | `useSearchEngine` | `SearchHandle \| null` |
| Search-level state | `useSearchState` | `SearchState` |
| Per-result reactivity | `useSearchResult` | `SearchResult` |
| Share search across tree | `createSearchContext` | `{ SearchProvider, useSearch, useSearchStatus, useSearchResult }` |
| Rust-owned state machine | `useStateMachineEngine` | `StateMachineHandle \| null` |
| SM-level state | `useStateMachineState` | `StateMachineState` |
| Per-state match reactivity | `useStateMatch` | `StateMatch` |
| Share SM across tree | `createStateMachineContext` | `{ StateMachineProvider, useStateMachine, useStateMachineStatus, useStateMatch }` |
| Rust-owned API state | `useApiEngine` | `ApiHandle \| null` |
| API-level state | `useApiState` | `ApiState` |
| Per-request reactivity | `useRequest` | `RequestState` |
| Share API across tree | `createApiContext` | `{ ApiProvider, useApi, useApiStatus, useRequest }` |
| Rust-owned virtual scroll state | `useVirtualScrollEngine` | `VirtualScrollHandle \| null` |
| Scroll-level state | `useVirtualScrollState` | `VirtualScrollState` |
| Per-item scroll reactivity | `useVirtualScrollItem` | `VirtualScrollItem` |
| Share scroll across tree | `createVirtualScrollContext` | `{ VirtualScrollProvider, useVirtualScroll, useVirtualScrollStatus, useVirtualScrollItem }` |
| Rust-owned validation state | `useValidationEngine` | `ValidationHandle \| null` |
| Validation-level state | `useValidationState` | `ValidationState` |
| Per-field validation | `useFieldValidation` | `FieldValidation` |
| Share validation across tree | `createValidationContext` | `{ ValidationProvider, useValidation, useValidationStatus, useFieldValidation }` |
| Rust-owned selection state | `useSelectionEngine` | `SelectionHandle \| null` |
| Selection-level state | `useSelectionState` | `SelectionState` |
| Per-item selection | `useSelectionItem` | `SelectionItem` |
| Share selection across tree | `createSelectionContext` | `{ SelectionProvider, useSelection, useSelectionStatus, useSelectionItem }` |
| Rust-owned command palette | `useCommandPaletteEngine` | `CommandPaletteHandle \| null` |
| Palette-level state | `useCommandPaletteState` | `CommandPaletteState` |
| Per-result palette reactivity | `useCommandPaletteResult` | `CommandPaletteResult` |
| Share palette across tree | `createCommandPaletteContext` | `{ CommandPaletteProvider, useCommandPalette, useCommandPaletteStatus, useCommandPaletteResult }` |
| Catch WASM panics | `WasmErrorBoundary` | React component |
| Manage WebSocket/SSE | `useConnection` | `{ pipeline, connected, state, error, stale }` |
| Off-thread WASM | `useWorker` | `{ loop, bridge, ready, error }` |

---

## Install

```bash
npm install org-asm
```

Peer dependencies: `react` (>=18), `zustand` (>=4), `rxjs` (>=7). All optional.

## Quick Start

### 0. Scaffold a Project (Recommended)

```bash
npx org-asm init my-app
cd my-app
npm install
npx org-asm build
```

This generates a complete full-stack project with WASM engine, server engine, shared crate, React app, and build scripts. Skip to step 3 to start customizing.

### 1. Define Your Frame Schema

Define a `.fbs` schema — the single source of truth for both Rust and TypeScript:

```fbs
// schema/frame.fbs
namespace MyApp;

table Frame {
  intensity: double = 0.0;
  is_active: bool = false;
  color_r: ubyte = 0;
  color_g: ubyte = 0;
  color_b: ubyte = 0;
}

root_type Frame;
```

Generate code for both sides:

```bash
flatc --rust -o crates/my-engine/src/generated/ schema/frame.fbs
flatc --ts  -o src/generated/ schema/frame.fbs
```

### 2. Create Your Rust Engine

Copy the template and customize:

```bash
cp node_modules/org-asm/model/engine-template.rs crates/my-engine/src/engine.rs
cp node_modules/org-asm/model/Cargo.template.toml crates/my-engine/Cargo.toml
```

Implement `tick()` using the generated FlatBuffer types:

```rust
use flatbuffers::FlatBufferBuilder;
use crate::generated::frame_generated::*;

#[wasm_bindgen]
impl Engine {
    pub fn tick(&mut self, now_ms: f64) {
        self.builder.reset();
        self.smooth_value += (self.current_value - self.smooth_value) * 0.08;
        let color = compute_color(self.smooth_value);

        let frame = Frame::create(&mut self.builder, &FrameArgs {
            intensity: self.smooth_value,
            is_active: self.active,
            color_r: color.0,
            color_g: color.1,
            color_b: color.2,
        });
        self.builder.finish(frame, None);
    }

    // JS reads FlatBuffer bytes zero-copy from WASM memory
    pub fn frame_ptr(&self) -> *const u8 {
        self.builder.finished_data().as_ptr()
    }

    pub fn frame_len(&self) -> usize {
        self.builder.finished_data().len()
    }
}
```

Build:
```bash
wasm-pack build crates/my-engine --target web --release
```

### 3. Wire with React Hooks

```tsx
import { useWasm, useAnimationLoop, useFrame, useConnection } from 'org-asm/react';
import init, { Engine } from './pkg/my_engine';
import { Frame } from './generated/frame';
import { ByteBuffer } from 'flatbuffers';

function App() {
  const { memory, ready } = useWasm(() => init());
  const engine = useMemo(() => ready ? new Engine() : null, [ready]);

  const loop = useAnimationLoop(engine, memory,
    bytes => Frame.getRootAsFrame(new ByteBuffer(bytes)));

  // React re-renders at 10fps with the latest intensity
  const intensity = useFrame(loop, f => f.intensity(), 100);

  // Connection state with error + staleness tracking
  const { pipeline, connected, state, error, stale } = useConnection({
    url: 'wss://your-source/ws',
    binaryType: 'arraybuffer',
  });

  // Wire data source to engine
  useEffect(() => {
    if (!engine) return;
    pipeline.onBinaryMessage(data => engine.ingest_frame(new Uint8Array(data)));
  }, [pipeline, engine]);

  return (
    <div>
      <div style={{ opacity: intensity ?? 0 }}>Value: {intensity?.toFixed(2)}</div>
      <span>{connected ? (stale ? 'Stale' : 'Live') : `Reconnecting... (${state})`}</span>
      {error && <span style={{ color: 'red' }}>{error.message}</span>}
    </div>
  );
}
```

5 lines to go from nothing to connected, with all state and logic in Rust.

### 4. Connect a Data Source

Message parsing belongs in Rust. The engine implements `ingest_message()` with serde_json — one boundary crossing replaces many, and zero JS objects are allocated.

```rust
// In your Rust engine:
#[wasm_bindgen]
pub fn ingest_message(&mut self, raw: &str, now_ms: f64) -> u32 {
    #[derive(Deserialize)]
    struct Msg { value: f64, timestamp: f64 }

    let msg: Msg = match serde_json::from_str(raw) {
        Ok(m) => m,
        Err(_) => return 0,
    };
    self.add_data_point(msg.value, msg.timestamp, now_ms);
    1 // INGEST_DATA_UPDATED
}
```

```ts
import { WebSocketPipeline, WasmIngestParser } from 'org-asm';

const parser = new WasmIngestParser(engine);
const ws = new WebSocketPipeline({ url: 'wss://your-source/ws' });
ws.onMessage((raw) => parser.parse(raw, engine, Date.now()));
ws.connect();
```

### 5. Server Engine (Optional)

For high-frequency data like orderbooks, run a server engine in native Rust that ingests exchange data and broadcasts FlatBuffer frames to all browser clients:

```bash
npx org-asm init my-app   # includes server crate
# or copy templates manually:
cp node_modules/org-asm/server/engine-trait.rs my-server/src/engine_trait.rs
cp node_modules/org-asm/server/broadcast.rs my-server/src/broadcast.rs
cp node_modules/org-asm/server/main-template.rs my-server/src/main.rs
cp node_modules/org-asm/server/Cargo.template.toml my-server/Cargo.toml
```

Implement the `ServerEngine` trait:

```rust
impl ServerEngine for OrderbookEngine {
    fn ingest(&mut self, msg: &[u8]) -> bool {
        // Parse exchange message, update orderbook state
        true
    }

    fn tick<'a>(&mut self, builder: &'a mut FlatBufferBuilder<'static>) -> &'a [u8] {
        builder.reset();
        // Serialize orderbook to FlatBuffer bytes
        builder.finished_data()
    }
}
```

### 6. Send Commands to the Server

Generate typed command helpers from your `.fbs` schema:

```bash
npx org-asm gen-builder schema/commands.fbs -o src/generated/
```

For schemas with a union-based root type (like `commands.fbs`), this produces three files:
- `CommandsBuilder.ts` — fluent builder helpers (all schemas)
- `CommandsSender.ts` — typed `CommandSender` subclass with sync + async methods per union member
- `useCommands.ts` — React hook returning the sender

Use the generated hook directly — no manual subclass needed:

```ts
import { useConnection } from 'org-asm/react';
import { useCommands } from './generated/useCommands';

const { pipeline } = useConnection({ url: 'wss://...' });
const commands = useCommands(pipeline);

// Fire-and-forget (returns command ID)
commands.subscribe({ symbol: 'BTC-USD', depth: 20 });
commands.unsubscribe({ symbol: 'BTC-USD' });
commands.requestSnapshot();

// Await server response (returns ArrayBuffer)
const response = await commands.subscribeAsync({ symbol: 'BTC-USD' });
```

Fields with schema defaults (e.g. `depth: uint16 = 20`) become optional in the generated args. Every method has both a sync variant (returns `bigint` command ID) and an `Async` variant (returns `Promise<R>` — `ArrayBuffer` by default, or a typed response if a deserializer is provided).

Use `--no-sender` to skip sender+hook generation, or `--no-hook` to skip just the hook.

### 7. Await Command Responses

The `Async` variants require a `ResponseRegistry` to correlate responses by command ID. The `useResponseRegistry` hook installs a binary middleware interceptor and handles disconnect cleanup:

```ts
import { WebSocketPipeline } from 'org-asm/controller';
import { useConnection, useResponseRegistry } from 'org-asm/react';
import { useCommands } from './generated/useCommands';

const ws = useMemo(() => new WebSocketPipeline({ url: 'wss://...', binaryType: 'arraybuffer' }), []);
const { connected } = useConnection(ws);

// Install registry as middleware — responses consumed, frames pass through
const registry = useResponseRegistry(ws, extractId);
const commands = useCommands(ws, registry);

const response = await commands.subscribeAsync({ symbol: 'ETH-USD' });
```

For typed responses, provide a deserializer — all `Async` methods return your type:

```ts
const registry = useResponseRegistry<MyResponse>(ws, extractId, {
  deserialize: (data) => MyResponse.getRootAsMyResponse(new ByteBuffer(new Uint8Array(data))),
});
const commands = useCommands(ws, registry);
const typed = await commands.subscribeAsync({ symbol: 'ETH-USD' }); // MyResponse
```

The `extractId` function reads the command ID from your response schema:

```ts
const extractId = (data: ArrayBuffer) => {
  const bb = new ByteBuffer(new Uint8Array(data));
  return ResponseMessage.getRootAsResponseMessage(bb).id(); // bigint | null
};
```

### 8. Auto-Replay Subscriptions on Reconnect

Use `SubscriptionManager` (or the `useSubscriptionManager` hook) to automatically replay subscribe commands when the connection drops and reconnects:

```ts
import { useSubscriptionManager } from 'org-asm/react';

const subs = useSubscriptionManager(ws);

// Subscribe (replays automatically on every reconnect)
subs?.add('BTC-USD', () => commands.subscribe({ symbol: 'BTC-USD', depth: 20 }));
subs?.add('ETH-USD', () => commands.subscribe({ symbol: 'ETH-USD' }));

// Unsubscribe (remove from replay list — send unsubscribe separately)
subs?.remove('BTC-USD');
commands.unsubscribe({ symbol: 'BTC-USD' });
```

### 9. Server-Side Command Handler (Rust)

Generate a Rust trait + dispatch function from your command schema:

```bash
npx org-asm gen-handler schema/commands.fbs -o server/src/generated/
```

This produces `commands_handler.rs` with a `CommandHandler` trait and `dispatch_command` function:

```rust
pub trait CommandHandler {
    fn handle_subscribe(&mut self, id: u64, symbol: &str, depth: u16) -> Option<Vec<u8>>;
    fn handle_unsubscribe(&mut self, id: u64, symbol: &str) -> Option<Vec<u8>>;
    fn handle_request_snapshot(&mut self, id: u64) -> Option<Vec<u8>>;
}
```

Implement the trait on your server engine:

```rust
impl CommandHandler for MyEngine {
    fn handle_subscribe(&mut self, id: u64, symbol: &str, depth: u16) -> Option<Vec<u8>> {
        self.subscriptions.insert(symbol.to_string(), depth);
        Some(build_ack(id)) // return response bytes, or None
    }
    // ...
}

// In your WebSocket handler:
if let Some(response) = dispatch_command(bytes, &mut engine) {
    ws_tx.send(Message::Binary(response.into())).await?;
}
```

Options: `--name <TraitName>` (default `{UnionName}Handler`), `--crate-path <path>` (default `crate::generated::{namespace}::*`).

### 10. Shared Rust Crate

Keep domain types, validation, and constants in a shared crate used by both server and WASM engines:

```bash
cp node_modules/org-asm/shared/lib-template.rs crates/shared/src/lib.rs
cp node_modules/org-asm/shared/Cargo.template.toml crates/shared/Cargo.toml
```

```rust
// crates/shared/src/lib.rs — add your domain types here
pub const SMOOTHING_FACTOR: f64 = 0.08;
pub const HISTORY_WINDOW_SEC: f64 = 30.0;

pub fn validate_positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

pub fn normalize(value: f64, min: f64, max: f64) -> f64 {
    ((value - min) / (max - min)).clamp(0.0, 1.0)
}
```

Both server and WASM crates import this:
```toml
[dependencies]
my-shared = { path = "../shared" }
```

### 11. Build Everything

```bash
npx org-asm build
```

Runs the full pipeline: `flatc` codegen (Rust + TS) → `wasm-pack build` → `cargo build --release` (server).

## API Reference

### React Hooks (`org-asm/react`)

#### WASM Data Hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useFrame(loop, extract, throttleMs?)` | `T \| null` | Throttled frame value subscription (default 100ms) |
| `useWasmCall(fn, deps)` | `T` | Synchronous on-demand WASM call (validation, formatting, derived values) |
| `useDebouncedWasmCall(fn, deps, ms)` | `T \| null` | Debounced WASM call for search/autocomplete (fires after quiet period) |
| `useWasmState(notifier, getSnapshot)` | `T` | Reactive WASM state via `useSyncExternalStore` — re-reads on `notify()` |
| `useWasmSelector(notifier, snap, isEqual?)` | `T` | Like `useWasmState` but with structural equality — prevents re-renders for object snapshots |

#### Async & Streaming

| Hook | Returns | Description |
|------|---------|-------------|
| `useAsyncWasmCall(fn, deps)` | `{ result, loading, error }` | Async WASM call with cancellation (wasm-bindgen-futures or worker offload) |
| `useWasmStream(fn, deps)` | `{ chunks, done, error }` | Streaming chunked results from WASM with rAF-batched updates |

#### State Management

| Hook | Returns | Description |
|------|---------|-------------|
| `useWasmReducer(engine, config)` | `[S, dispatch]` | Rust-first state management — engine owns state, dispatch triggers mutation + re-render |
| `createWasmContext<E>()` | `{ WasmProvider, useEngine, useNotifier }` | Factory for sharing engine + notifier across component tree without prop drilling |
| `WasmErrorBoundary` | React component | Error boundary for WASM panics — catches errors, shows fallback, supports reset |

#### Form Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useFormEngine(engine)` | `FormHandle \| null` | Create dispatch handle wrapping a Rust IFormEngine — setField, touchField, submit, reset |
| `useFormField(handle, name)` | `FieldState` | Per-field subscription — only re-renders when this field changes (value, error, showError) |
| `useFormState(handle)` | `FormState` | Form-level subscription — isValid, isDirty, canSubmit, hasBeenSubmitted, dataVersion |
| `createFormContext<E>()` | `{ FormProvider, useForm, useField, useFormStatus }` | Context factory for sharing form across component tree without prop drilling |

#### Table Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useTableEngine(engine, memory?)` | `TableHandle \| null` | Create dispatch handle wrapping a Rust ITableEngine -- sort, filter, paginate, select, edit, group |
| `useTableRow(handle, rowIndex)` | `RowState` | Per-row subscription -- only re-renders when this row's selection state changes |
| `useTableCell(handle, rowIndex, column)` | `CellState` | Per-cell subscription -- edit value, error, dirty state |
| `useTableState(handle)` | `TableState` | Table-level subscription -- page, sort, filter, selection, edits, grouping, dataVersion |
| `createTableContext<E>()` | `{ TableProvider, useTable, useRow, useCell, useTableStatus }` | Context factory for sharing table across component tree without prop drilling |

#### Auth Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useAuthEngine(engine)` | `AuthHandle \| null` | Create dispatch handle wrapping a Rust IAuthEngine -- setTokens, setAuthenticated, logout, setPermissions, setRoles, reset |
| `useAuthState(handle)` | `AuthState` | Auth-level subscription -- status, isAuthenticated, userId, userDisplayName, permissionCount, roleCount, dataVersion |
| `usePermission(handle, name)` | `PermissionState` | Per-permission subscription -- only re-renders when this permission's granted state changes |
| `useRole(handle, role)` | `RoleState` | Per-role subscription -- only re-renders when this role's granted state changes |
| `createAuthContext<E>()` | `{ AuthProvider, useAuth, useAuthStatus, usePermission, useRole }` | Context factory for sharing auth across component tree without prop drilling |

#### Router Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useRouterEngine(engine)` | `RouterHandle \| null` | Create dispatch handle wrapping a Rust IRouterEngine -- push, replace, back, forward, setQueryParam, resolveGuard, reset |
| `useRoute(handle)` | `RouteState` | Route-level subscription -- path, routeId, queryString, canGoBack, canGoForward, pendingGuard, dataVersion |
| `useRouteMatch(handle, routeId)` | `RouteMatch` | Per-route match subscription -- only re-renders when this route's match/allowed state changes |
| `createRouterContext<E>()` | `{ RouterProvider, useRouter, useRoute, useRouteMatch }` | Context factory for sharing router across component tree without prop drilling |

#### History Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useHistoryEngine(engine)` | `HistoryHandle \| null` | Create dispatch handle wrapping a Rust IHistoryEngine -- pushCommand, pushBatch, undo, redo, checkpoint, clearHistory, reset |
| `useHistoryState(handle)` | `HistoryState` | History-level subscription -- canUndo, canRedo, undoCount, redoCount, isAtCheckpoint, hasUnsavedChanges, dataVersion |
| `useUndoEntry(handle, index)` | `CommandEntry` | Per-entry undo subscription -- only re-renders when this entry's label changes |
| `useRedoEntry(handle, index)` | `CommandEntry` | Per-entry redo subscription -- only re-renders when this entry's label changes |
| `createHistoryContext<E>()` | `{ HistoryProvider, useHistory, useHistoryStatus, useUndoItem, useRedoItem }` | Context factory for sharing history across component tree without prop drilling |

#### Intl Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useIntlEngine(engine)` | `IntlHandle \| null` | Create dispatch handle wrapping a Rust IIntlEngine -- setLocale, loadMessages, translate, reset |
| `useIntlState(handle)` | `IntlState` | Intl-level subscription -- locale, fallbackLocale, messageCount, missingKeyCount, dataVersion |
| `useTranslation(handle, key)` | `TranslationState` | Per-key translation subscription -- only re-renders when this key's translation changes |
| `createIntlContext<E>()` | `{ IntlProvider, useIntl, useIntlStatus, useTranslation }` | Context factory for sharing intl across component tree without prop drilling |

#### Search Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useSearchEngine(engine)` | `SearchHandle \| null` | Create dispatch handle wrapping a Rust ISearchEngine -- setQuery, addFilter, setSort, setPage, loadItems, reset |
| `useSearchState(handle)` | `SearchState` | Search-level subscription -- query, resultCount, page, pageSize, pageCount, sortField, filterCount, dataVersion |
| `useSearchResult(handle, index)` | `SearchResult` | Per-result subscription -- only re-renders when this result's id changes |
| `createSearchContext<E>()` | `{ SearchProvider, useSearch, useSearchStatus, useSearchResult }` | Context factory for sharing search across component tree without prop drilling |

#### State Machine Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useStateMachineEngine(engine)` | `StateMachineHandle \| null` | Create dispatch handle wrapping a Rust IStateMachineEngine -- sendEvent, resolveGuard, setContext, reset |
| `useStateMachineState(handle)` | `StateMachineState` | SM-level subscription -- currentState, pendingGuard, transitionCount, availableEventCount, dataVersion |
| `useStateMatch(handle, stateId)` | `StateMatch` | Per-state match subscription -- only re-renders when this state's active status changes |
| `createStateMachineContext<E>()` | `{ StateMachineProvider, useStateMachine, useStateMachineStatus, useStateMatch }` | Context factory for sharing state machine across component tree without prop drilling |

#### API Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useApiEngine(engine)` | `ApiHandle \| null` | Create dispatch handle wrapping a Rust IApiEngine -- registerEndpoint, beginRequest, setRequestSuccess, buildUrl, reset |
| `useApiState(handle)` | `ApiState` | API-level subscription -- endpointCount, activeRequestCount, dataVersion |
| `useRequest(handle, requestId)` | `RequestState` | Per-request subscription -- only re-renders when this request's status changes |
| `createApiContext<E>()` | `{ ApiProvider, useApi, useApiStatus, useRequest }` | Context factory for sharing API across component tree without prop drilling |

#### VirtualScroll Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useVirtualScrollEngine(engine)` | `VirtualScrollHandle \| null` | Create dispatch handle wrapping a Rust IVirtualScrollEngine -- setViewportHeight, setItemCount, setScrollOffset, scrollToIndex, reset |
| `useVirtualScrollState(handle)` | `VirtualScrollState` | Scroll-level subscription -- itemCount, viewportHeight, scrollOffset, visibleStart, visibleEnd, totalHeight, dataVersion |
| `useVirtualScrollItem(handle, index)` | `VirtualScrollItem` | Per-item subscription -- only re-renders when this item's position/visibility changes |
| `createVirtualScrollContext<E>()` | `{ VirtualScrollProvider, useVirtualScroll, useVirtualScrollStatus, useVirtualScrollItem }` | Context factory for sharing virtual scroll across component tree without prop drilling |

#### Validation Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useValidationEngine(engine)` | `ValidationHandle \| null` | Create dispatch handle wrapping a Rust IValidationEngine -- addRule, addSchema, validateJson, clearErrors, reset |
| `useValidationState(handle)` | `ValidationState` | Validation-level subscription -- ruleCount, schemaCount, pendingValidationCount, dataVersion |
| `useFieldValidation(handle, schemaId, field)` | `FieldValidation` | Per-field subscription -- only re-renders when this field's validation state changes |
| `createValidationContext<E>()` | `{ ValidationProvider, useValidation, useValidationStatus, useFieldValidation }` | Context factory for sharing validation across component tree without prop drilling |

#### Selection Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useSelectionEngine(engine)` | `SelectionHandle \| null` | Create dispatch handle wrapping a Rust ISelectionEngine -- select, toggle, selectRange, moveFocus, activateFocus, reset |
| `useSelectionState(handle)` | `SelectionState` | Selection-level subscription -- mode, itemCount, selectedCount, focusId, anchorId, dataVersion |
| `useSelectionItem(handle, id)` | `SelectionItem` | Per-item subscription -- only re-renders when this item's selection/focus state changes |
| `createSelectionContext<E>()` | `{ SelectionProvider, useSelection, useSelectionStatus, useSelectionItem }` | Context factory for sharing selection across component tree without prop drilling |

#### CommandPalette Engine

| Hook | Returns | Description |
|------|---------|-------------|
| `useCommandPaletteEngine(engine)` | `CommandPaletteHandle \| null` | Create dispatch handle wrapping a Rust ICommandPaletteEngine -- registerCommand, setQuery, markExecuted, resolveKeybinding, reset |
| `useCommandPaletteState(handle)` | `CommandPaletteState` | Palette-level subscription -- commandCount, query, resultCount, page, pageSize, lastExecutedId, dataVersion |
| `useCommandPaletteResult(handle, index)` | `CommandPaletteResult` | Per-result subscription -- only re-renders when this result's state changes |
| `createCommandPaletteContext<E>()` | `{ CommandPaletteProvider, useCommandPalette, useCommandPaletteStatus, useCommandPaletteResult }` | Context factory for sharing command palette across component tree without prop drilling |

#### Connection & Infrastructure

| Hook | Returns | Description |
|------|---------|-------------|
| `useWasm(initFn)` | `{ memory, ready, error }` | Initialize WASM module, track loading state |
| `useAnimationLoop(engine, memory, rootFn)` | `AnimationLoop \| null` | Create 60fps loop with FlatBuffer adapter |
| `useEngine(loop, engine, memory, rootFn)` | `EngineHandle \| null` | Register a FlatBuffer engine on a shared `MultiAnimationLoop` |
| `useEngine(loop, tickSource)` | `EngineHandle \| null` | Register a raw tick source on a shared `MultiAnimationLoop` |
| `useConnection(config)` | `{ pipeline, connected, state, error, stale }` | WebSocket/SSE with full connection state, error, and staleness tracking |
| `useWorker(config)` | `{ loop, bridge, ready, error }` | Off-main-thread WASM via Worker + SharedArrayBuffer |
| `useResponseRegistry(pipeline, extractId, options?)` | `ResponseRegistry<R> \| null` | Wire response correlation as binary middleware + disconnect cleanup |
| `useSubscriptionManager(pipeline)` | `SubscriptionManager \| null` | Track subscriptions and auto-replay on reconnect |
| `useOrgAsmDiagnostics({ pipeline, registry })` | `DiagnosticsData` | Poll connection stats, message rates, pending commands at ~2Hz |
| `OrgAsmDevTools` | React component | Drop-in floating diagnostics panel (connection, msg/s, pending) |

### Core

#### `flatBufferTickAdapter(engine, memory, rootFn)`

Creates a tick source that reads FlatBuffer frames zero-copy from WASM memory. Plugs into `AnimationLoop`.

#### Interfaces

| Interface | Role |
|-----------|------|
| `IEngine` | Model contract: `tick()`, `addDataPoint()`, `openAction()`, `closeAction()` |
| `IFrameConsumer` | Receives `onFrame(frame, nowMs)` at 60fps. Has `priority` for ordering. |
| `IAnimationLoop` | `start()` / `stop()` / `addConsumer()` / `removeConsumer()` |
| `IChartRenderer` | Extends `IFrameConsumer` with `setData()`, `setTimeWindow()`, `resize()`, `destroy()` |
| `IEffectApplicator` | Extends `IFrameConsumer` with `bind()`, `unbind()`, `getCSSEffects()` |
| `IWasmIngestEngine` | WASM-side message parsing via `ingest_message()` |
| `IWasmBinaryIngestEngine` | Binary frame ingestion via `ingest_frame()` for server engine pipeline |
| `IFormEngine` | Form engine contract: `set_field()`, `submit()`, `field_error()`, `is_valid()` |
| `IWizardFormEngine` | Multi-step form extension: `step()`, `advance()`, `go_back()` |
| `ITableEngine` | Table engine contract: `set_page()`, `toggle_sort()`, `set_filter()`, `toggle_row()`, `set_edit_value()`, `set_group_by()` |
| `IAuthEngine` | Auth engine contract: `set_tokens()`, `set_authenticated()`, `logout()`, `has_permission()`, `has_role()`, `set_permissions()`, `set_roles()` |
| `IRouterEngine` | Router engine contract: `navigate()`, `replace()`, `back()`, `forward()`, `is_match()`, `resolve_guard()`, `param()`, `query_param()` |
| `IHistoryEngine` | History engine contract: `push_command()`, `push_batch()`, `undo()`, `redo()`, `checkpoint()`, `has_unsaved_changes()`, `set_max_history()` |
| `IIntlEngine` | Intl engine contract: `set_locale()`, `load_messages()`, `translate()`, `translate_plural()`, `set_fallback_locale()` |
| `ISearchEngine` | Search engine contract: `load_items()`, `set_query()`, `add_filter()`, `set_sort()`, `set_page()`, `get_result_value()`, `get_facet_count()` |
| `IStateMachineEngine` | State machine engine contract: `add_state()`, `add_transition()`, `send_event()`, `resolve_guard()`, `set_context()`, `is_in_state()` |
| `IApiEngine` | API engine contract: `register_endpoint()`, `begin_request()`, `set_request_success()`, `build_url()`, `is_cached()`, `invalidate_cache()` |
| `IVirtualScrollEngine` | Virtual scroll contract: `set_viewport_height()`, `set_item_count()`, `set_scroll_offset()`, `scroll_to_index()`, `visible_start()`, `visible_end()` |
| `IValidationEngine` | Validation contract: `add_rule()`, `add_schema()`, `validate_json()`, `field_error()`, `start_validation()`, `resolve_async_validation()` |
| `ISelectionEngine` | Selection contract: `select()`, `deselect()`, `toggle()`, `select_range()`, `move_focus()`, `activate_focus()`, `set_mode()` |
| `ICommandPaletteEngine` | Command palette contract: `register_command()`, `set_query()`, `resolve_keybinding()`, `mark_executed()`, `result_id()`, `result_score()` |
| `WasmNotifier` | Pub/sub interface for `useWasmState` — `subscribe()`, `notify()`, `batch()` |

### View

#### `AnimationLoop`

60fps `requestAnimationFrame` loop. Calls `engine.tick()` once per frame, distributes the frame to consumers in priority order.

#### `MultiAnimationLoop`

Single `requestAnimationFrame` loop that ticks multiple engines. Each engine gets its own typed consumer list via `EngineHandle<F>`, which implements `IAnimationLoop<F>` and works as a drop-in for `AnimationLoop` with `useFrame()` and other consumer hooks. Use when an app has multiple independent engines (e.g. orderbook + chart + analytics) to avoid N separate rAF callbacks.

```tsx
const loop = new MultiAnimationLoop();

// In component A
const obHandle = useEngine(loop, obEngine, obMemory, parseOb);
const bid = useFrame(obHandle, f => f.bestBid());

// In component B (same loop instance via props or context)
const chartHandle = useEngine(loop, chartEngine, chartMemory, parseChart);
const price = useFrame(chartHandle, f => f.price());
```

#### `EffectApplicator` (priority: 10)

Declarative frame-to-DOM bindings. Bind once at setup, applied every frame.

| Method | Description |
|--------|-------------|
| `bind(name, element)` | Register a DOM element by name |
| `bindCSSProperty(name, prop, extract, format?)` | `el.style.setProperty('--prop', extract(frame))` |
| `bindStyle(name, prop, extract, format?)` | `el.style[prop] = extract(frame)` |
| `bindTransform(name, extract, compute, threshold?)` | `el.style.transform = compute(extract(frame))` |
| `bindConditional(flagExtract, onTrue, onFalse?)` | Switch bindings based on boolean extractor |

#### `ChartDataConsumer` (priority: 0)

Version-gated chart data sync. Only copies data from WASM when `data_version()` changes. Library-agnostic via `ChartDataSink` interface.

#### `ThrottledStateSync` (priority: 20)

Bridges 60fps frame data to React at configurable intervals.

### Controller

#### `WebSocketPipeline`

Auto-reconnecting WebSocket with state machine, exponential backoff with jitter, staleness tracking, optional binary backpressure (rAF coalescing), and structured error surfacing. Supports binary + text messages and `send()` / `sendBinary()` for bidirectional communication.

**Connection state:** `ConnectionState` enum — `Disconnected` → `Connecting` → `Connected` → `Reconnecting` (on drop). Access via `pipeline.state`.

**Backoff:** Exponential with jitter. Base 1s, caps at 30s. Configure via `reconnectDelayMs` / `maxReconnectDelayMs`.

**Staleness:** `pipeline.stale` returns true when no message received within `staleThresholdMs` (default 5s). `pipeline.lastMessageTime` returns the raw timestamp.

**Backpressure:** Set `backpressure: true` to coalesce binary frames via `requestAnimationFrame` (latest-wins). Text messages pass through immediately.

**Error surfacing:** `pipeline.onError(handler)` fires `ConnectionError` with type (`connect_failed` | `connection_lost` | `max_retries_exhausted`), attempt count, and timestamp. All `on*` handlers are multi-subscriber — calling `onConnect(h1)` then `onConnect(h2)` fires both.

**Heartbeat:** Set `heartbeatIntervalMs` to send periodic keepalive messages, preventing proxy/firewall timeouts. Configure `heartbeatMessage` (default: single zero byte).

**Binary middleware:** `pipeline.use((data, next) => { ... })` installs an interceptor on the binary message path. Middleware runs in order before the terminal `onBinaryMessage` handler. Returns an unsubscribe function. Used internally by `ResponseRegistry` to intercept responses.

**Diagnostics:** `pipeline.messageCount` and `pipeline.binaryMessageCount` track total messages received.

#### `WasmIngestParser`

Delegates raw WebSocket strings to the Rust engine's `ingest_message()` — all parsing happens in WASM.

#### `BinaryFrameParser`

Feeds binary FlatBuffer frames from a server engine to a WASM client engine via `ingest_frame()`.

#### `ResponseRegistry<R>`

Correlates command responses by ID. Generic over response type `R` (defaults to `ArrayBuffer`). Standalone class — no dependency on `CommandSender`.

| Method | Description |
|--------|-------------|
| `constructor(extractId, timeoutMs?, deserialize?)` | Create registry with ID extractor, optional timeout (default 5000ms), optional deserializer |
| `register(id: bigint)` | Create pending `Promise<R>` for a command ID, rejects on timeout |
| `handleMessage(data: ArrayBuffer)` | Match incoming message as response, deserialize and resolve. Returns `true` if consumed |
| `rejectAll(reason: string)` | Reject all pending promises (call on disconnect) |
| `pendingCount` | Number of in-flight requests |

#### `SubscriptionManager`

Tracks active subscriptions and replays them on reconnect. Hooks into `pipeline.onConnect()`.

| Method | Description |
|--------|-------------|
| `constructor(pipeline)` | Create manager, wire reconnect replay |
| `add(key, replayFn)` | Track a subscription and execute immediately |
| `remove(key)` | Remove from replay list (does not send unsubscribe) |
| `has(key)` | Check if key is active |
| `replayAll()` | Replay all subscriptions (called automatically on reconnect) |
| `size` | Number of active subscriptions |
| `keys` | All active subscription keys |

#### `CommandBuilder` / `CommandSender<B>`

Two-class pattern for typed commands. Extend `CommandBuilder` with instance methods wrapping generated FlatBuffer statics (`b.startX()` instead of `X.startX(builder)`). Extend `CommandSender<B>` with typed command methods. Builder reuse, auto-incrementing IDs. Supports `sendWithResponse()` for async request/response via `ResponseRegistry`.

#### `SSEPipeline`

Auto-reconnecting Server-Sent Events pipeline implementing `IConnectionPipeline`. Same state machine, backoff, and staleness tracking as `WebSocketPipeline`. Read-only transport — `send()` is a no-op for Liskov substitutability.

**Config:** `url`, `eventTypes` (default `['message']`), `withCredentials`, plus same reconnect/staleness config as WS.

**Limitation:** `EventSource` does not support custom headers. Use URL query parameters or cookies for authentication.

**Swapping transports:**
```ts
// WebSocket path
const { pipeline, connected } = useConnection({ url: 'wss://...' });

// SSE path — same hook, same result shape
const sse = useMemo(() => new SSEPipeline({ url: '/events' }), []);
const { pipeline, connected } = useConnection(sse);
```

Both `WebSocketPipeline` and `SSEPipeline` implement `IConnectionPipeline`, so `useConnection()` accepts either.

#### `WorkerBridge`

Main-thread coordinator for off-main-thread WASM computation. Spawns a Worker, sends it a `SharedArrayBuffer`, and manages the lifecycle. The Worker runs the WASM engine on `setInterval` (~60fps) and writes frames into the SAB. The main thread reads the latest frame on each `requestAnimationFrame` tick — zero `postMessage` overhead per frame.

**Requires COOP/COEP headers** for `SharedArrayBuffer`:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Quick start (Worker path):**
```tsx
import { useWorker, useFrame } from 'org-asm/react';

const { loop, bridge, ready } = useWorker({
  workerUrl: new URL('./my-worker.ts', import.meta.url),
  frameSize: 39,
  wasmUrl: './pkg/my_engine_bg.wasm',
  engineConstructor: 'MyEngine',
});

const intensity = useFrame(loop, f => f[0], 100);
```

#### `WasmTaskWorker`

Promise-based worker for one-off WASM computation. Unlike `WorkerBridge` (frame-oriented with SharedArrayBuffer + tick interval), `WasmTaskWorker` is request/response: send a method name + args, get a Promise back.

| Method | Description |
|--------|-------------|
| `constructor(config)` | Create worker with `workerUrl`, `wasmUrl`, `engineConstructor` |
| `initialize()` | Spawn worker, load WASM, wait for ready |
| `call(method, args?)` | Invoke engine method, returns `Promise<T>` |
| `ready` | Whether the worker is initialized |
| `pendingCount` | Number of in-flight calls |
| `dispose()` | Terminate worker, reject pending calls |

#### `SharedBufferTickSource`

Factory functions for creating tick sources that read from `SharedArrayBuffer`:

| Factory | Mode | Description |
|---------|------|-------------|
| `sharedBufferTickSource(buffer, frameSize)` | Float64Array | Zero-copy subarray view into SAB |
| `sharedBufferFlatBufferTickSource(buffer, maxBytes, rootFn)` | FlatBuffer | Copy + deserialize from SAB |
| `withSequenceTracking(source, buffer)` | Wrapper | Adds `.newFrame` boolean per tick |

#### `InputController`

Maps DOM events to engine actions with start/end lifecycle.

### Server (Rust templates)

#### `ServerEngine` trait

| Method | Description |
|--------|-------------|
| `ingest(&mut self, msg: &[u8]) -> bool` | Process raw exchange message, return true if state changed |
| `tick(&mut self, builder: &mut FlatBufferBuilder) -> &[u8]` | Serialize state to FlatBuffer bytes |
| `snapshot(&self, builder: &mut FlatBufferBuilder) -> Option<Vec<u8>>` | Optional full state for late-joining clients |

#### `BroadcastState`

Fan-out binary frames to all WebSocket clients via `tokio::sync::broadcast`.

#### Command Handler

Template for processing client commands (subscribe/unsubscribe). See `server/command-handler-template.rs`.

### CLI

| Command | Description |
|---------|-------------|
| `npx org-asm init <name>` | Scaffold full-stack project (WASM + server + shared + React) |
| `npx org-asm build` | Run `flatc` + `wasm-pack` + `cargo build` pipeline |
| `npx org-asm gen-builder <schema.fbs>` | Generate builder + sender + hook from FlatBuffers schema (sender/hook for union schemas only) |
| `npx org-asm gen-handler <schema.fbs>` | Generate Rust `CommandHandler` trait + dispatch from FlatBuffers schema (requires union root) |

## FlatBuffers Schema Types

| FlatBuffers Type | Rust Type | TypeScript Accessor |
|------------------|-----------|---------------------|
| `double` | `f64` | `frame.intensity()` |
| `bool` | `bool` | `frame.isActive()` |
| `ubyte` | `u8` | `frame.colorR()` |
| `struct` | inline struct | zero-copy, no vtable |
| `[struct]` | `&[T]` | sequential cache-friendly access |

## Design Principles

- **Rust owns all state** — no JS-side state duplication. The WASM engine is the single source of truth.
- **Shared Rust crate** — domain logic, validation, and types compiled once, used in both server (native) and client (WASM). No logic duplication across tiers.
- **Minimal boundary crossings** — FlatBuffer frames batch all state into one WASM→JS call. On-demand methods return results directly.
- **Zero allocations in hot paths** — FlatBuffer bytes read directly from WASM linear memory, pre-allocated buffers reused per frame
- **Throttled React updates** — 60fps data reaches React at ~10fps via `useFrame()` hook. Real-time paths bypass React entirely.
- **Non-animation paths** — On-demand validation via `useWasmCall`, reactive state via `useWasmState`, async computation via `useAsyncWasmCall`, reducer pattern via `useWasmReducer`. Not everything needs 60fps.
- **FlatBuffer commands** — typed bidirectional communication, builder reuse eliminates allocation
- **Composable binary middleware** — `pipeline.use()` chain with zero-copy pass-through, no handler conflicts

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `flatbuffers` | FlatBuffers runtime for typed frame deserialization |
| `react` (peer, optional) | React hooks for WASM + frame + connection state |
| `zustand` (peer, optional) | React state management with selector subscriptions |
| `rxjs` (peer, optional) | Throttled streams for high-frequency data bridging |
| `wasm-bindgen` (Rust) | Rust-JS boundary bindings |

Zero DOM library dependencies. Works with any chart library via `ChartDataSink`, any React version via hooks.

## Status

- [ ] Example apps (orderbook dashboard, sensor monitor)
- [ ] Benchmark suite

## License

MIT
