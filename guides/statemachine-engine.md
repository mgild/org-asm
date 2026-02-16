# State Machine Engine Pattern

Rust-owned generic finite state machine with two-phase guards, parallel states, context bag, and action descriptors. The WASM engine owns ALL FSM state -- current state, transitions, guards, context data, history. TypeScript is a dumb dispatcher that sends events and reads state back.

## When to Use

Use the state machine engine when your app has:
- Complex UI workflows (checkout flows, multi-step wizards, approval pipelines)
- State-driven rendering where components change based on machine state
- Guard-protected transitions (auth checks, validation gates)
- Context data that evolves with state transitions

NOT for simple boolean toggles or linear step wizards. For those, use `useWasmReducer` or the wizard form engine.

## Quick Start

### 1. Implement IStateMachineEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/statemachine-engine-template.rs crates/my-engine/src/statemachine.rs
```

Customize two things:

1. **State/transition table** -- define states, events, and allowed transitions
2. **Guard definitions** -- specify which transitions require async approval

```rust
fn init_machine(&mut self) {
    self.add_state("idle", "Idle");
    self.add_state("loading", "Loading Data");
    self.add_state("review", "Review");
    self.add_state("submitted", "Submitted");
    self.add_state("error", "Error");

    self.add_transition("idle", "FETCH", "loading", &[]);
    self.add_transition("loading", "SUCCESS", "review", &[]);
    self.add_transition("loading", "FAILURE", "error", &[]);
    self.add_transition("review", "SUBMIT", "submitted", &["auth"]);
    self.add_transition("review", "CANCEL", "idle", &[]);
    self.add_transition("error", "RETRY", "loading", &[]);

    self.set_initial_state("idle");
}
```

### 2. Wire with React Hooks

```tsx
import { useStateMachineEngine, useStateMachineState, useStateMatch } from 'org-asm/react';

function CheckoutFlow() {
  const engine = useMemo(() => new MyStateMachineEngine(), []);
  const handle = useStateMachineEngine(engine);

  return (
    <div>
      <StateIndicator handle={handle} />
      <GuardResolver handle={handle} />
      <FlowContent handle={handle} />
    </div>
  );
}

function StateIndicator({ handle }: { handle: StateMachineHandle | null }) {
  const { currentState, transitionCount } = useStateMachineState(handle);
  return <div>State: {currentState} (transitions: {transitionCount})</div>;
}

function GuardResolver({ handle }: { handle: StateMachineHandle | null }) {
  const { pendingGuard } = useStateMachineState(handle);

  useEffect(() => {
    if (!pendingGuard) return;
    // Resolve the guard (e.g., check auth)
    checkAuth(pendingGuard).then(allowed => handle?.resolveGuard(allowed));
  }, [pendingGuard]);

  return pendingGuard ? <div>Checking: {pendingGuard}...</div> : null;
}

function FlowContent({ handle }: { handle: StateMachineHandle | null }) {
  const { currentState } = useStateMachineState(handle);

  switch (currentState) {
    case 'idle':
      return <button onClick={() => handle?.sendEvent('FETCH')}>Start</button>;
    case 'loading':
      return <div>Loading...</div>;
    case 'review':
      return (
        <div>
          <ReviewForm />
          <button onClick={() => handle?.sendEvent('SUBMIT')}>Submit</button>
          <button onClick={() => handle?.sendEvent('CANCEL')}>Cancel</button>
        </div>
      );
    case 'submitted':
      return <div>Success!</div>;
    case 'error':
      return <button onClick={() => handle?.sendEvent('RETRY')}>Retry</button>;
    default:
      return null;
  }
}

function ReviewGuard({ handle }: { handle: StateMachineHandle | null }) {
  const { isActive } = useStateMatch(handle, 'review');
  if (!isActive) return null;
  return <div>You are in the review step</div>;
}
```

### 3. Context (optional -- no prop drilling)

```tsx
import { createStateMachineContext } from 'org-asm/react';

const { StateMachineProvider, useStateMachine, useStateMachineStatus, useStateMatch } =
  createStateMachineContext<MyStateMachineEngine>();

function App() {
  const engine = useMemo(() => new MyStateMachineEngine(), []);
  return (
    <StateMachineProvider engine={engine}>
      <CheckoutFlow />
    </StateMachineProvider>
  );
}

function SendButton({ event, label }: { event: string; label: string }) {
  const { sendEvent } = useStateMachine();
  return <button onClick={() => sendEvent(event)}>{label}</button>;
}

function CurrentState() {
  const { currentState } = useStateMachineStatus();
  return <span>{currentState}</span>;
}

function ActiveGuard({ stateId }: { stateId: string }) {
  const { isActive, label } = useStateMatch(stateId);
  return isActive ? <span>{label}</span> : null;
}
```

## IStateMachineEngine Contract

### Machine Definition

| Method | Type | Description |
|--------|------|-------------|
| `add_state(id, label)` | `&mut self` | Register a state with display label, bump version |
| `add_transition(from, event, to, guards)` | `&mut self` | Register a transition with optional guard names, bump version |
| `set_initial_state(id)` | `&mut self` | Set the starting state and enter it, bump version |
| `set_guard(transition_key, guard_name)` | `&mut self` | Attach a guard to an existing transition, bump version |

### Event Dispatch

| Method | Type | Description |
|--------|------|-------------|
| `send_event(event)` | `&mut self` | Fire an event -- transition if allowed, trigger guard if needed, bump version |
| `resolve_guard(allowed)` | `&mut self` | Resolve a pending guard, complete or reject transition, bump version |

### Context

| Method | Type | Description |
|--------|------|-------------|
| `set_context(json)` | `&mut self` | Replace the entire context bag with JSON, bump version |
| `merge_context(json)` | `&mut self` | Merge JSON into existing context bag, bump version |

### State Reads

| Method | Type | Description |
|--------|------|-------------|
| `get_state_machine_state()` | `&self` | Full snapshot as StateMachineState |
| `can_send(event)` | `&self` | Whether the event has a valid transition from current state |
| `get_available_event(index)` | `&self` | Event name available at index from current state (empty if out of bounds) |
| `get_on_enter_action(state_id)` | `&self` | JSON action descriptor for entering a state (empty if none) |
| `get_on_exit_action(state_id)` | `&self` | JSON action descriptor for exiting a state (empty if none) |
| `is_in_state(state_id)` | `&self` | Whether the machine is currently in the given state |
| `context_json()` | `&self` | Current context bag as JSON string |
| `state_history(index)` | `&self` | State ID at history index (0 = most recent, empty if out of bounds) |

### State

| Method | Type | Description |
|--------|------|-------------|
| `data_version()` | `&self` | Monotonically increasing change counter |
| `reset()` | `&mut self` | Reset machine to initial state, clear context and history |

## Two-Phase Guard Protocol

Guards use the same two-phase protocol as the router engine:

1. **Event fires** (`sendEvent('SUBMIT')`) -- engine finds transition, sees `auth` guard
2. **Engine sets** `pendingGuard = "auth"` and bumps `data_version`
3. **TypeScript reads** `pendingGuard` from `useStateMachineState()` and runs the check
4. **TypeScript calls** `resolveGuard(true)` or `resolveGuard(false)`
5. **Engine either** completes the transition or stays in current state

```ts
useEffect(() => {
  if (!pendingGuard) return;

  if (pendingGuard === 'auth') {
    const isLoggedIn = authHandle?.isAuthenticated() ?? false;
    handle?.resolveGuard(isLoggedIn);
  } else if (pendingGuard === 'can_submit') {
    const isValid = formHandle?.isValid() ?? false;
    handle?.resolveGuard(isValid);
  }
}, [pendingGuard]);
```

When `resolveGuard(false)` is called, the transition is aborted and the machine stays in its current state.

## Action Descriptors

States can have on-enter and on-exit action descriptors -- JSON blobs that tell TypeScript what side effects to trigger:

```rust
// In Rust: attach action descriptors to states
self.set_on_enter_action("loading", r#"{"type":"fetch","url":"/api/data"}"#);
self.set_on_exit_action("loading", r#"{"type":"cancel_fetch"}"#);
```

```ts
// In TypeScript: read and execute
useEffect(() => {
  const action = handle?.getOnEnterAction(currentState);
  if (!action) return;
  const desc = JSON.parse(action);
  if (desc.type === 'fetch') fetchData(desc.url);
}, [currentState]);
```

## Context Bag

The context bag is an opaque JSON object that evolves alongside state transitions. Use it to carry data between states:

```ts
// Set initial context
handle?.setContext(JSON.stringify({ userId: '42', cart: [] }));

// Merge new data (preserves existing keys)
handle?.mergeContext(JSON.stringify({ selectedPlan: 'pro' }));

// Read context in any component
const ctx = JSON.parse(handle?.contextJson() ?? '{}');
```

## Types

### StateMachineState

```typescript
interface StateMachineState {
  currentState: string;        // Current state ID
  pendingGuard: string;        // Guard awaiting resolution (empty if none)
  transitionCount: number;     // Total transitions taken
  availableEventCount: number; // Number of events valid from current state
  stateCount: number;          // Total registered states
  historyLength: number;       // Number of entries in state history
}
```

### StateMatch

```typescript
interface StateMatch {
  stateId: string;             // The state being matched
  isActive: boolean;           // Whether the machine is currently in this state
  label: string;               // Display label for the state
}
```

## Testing

Mock the engine in tests with a plain JS object:

```typescript
function createMockStateMachineEngine(): IStateMachineEngine {
  let _currentState = '';
  let _pendingGuard = '';
  let _dataVersion = 0;
  let _transitionCount = 0;
  let _context = '{}';
  const _states = new Map<string, string>();
  const _transitions = new Map<string, { to: string; guards: string[] }>();
  const _history: string[] = [];

  const transitionKey = (from: string, event: string) => `${from}:${event}`;

  return {
    add_state: (id: string, label: string) => { _states.set(id, label); _dataVersion++; },
    add_transition: (from: string, event: string, to: string, guards: string[]) => {
      _transitions.set(transitionKey(from, event), { to, guards });
      _dataVersion++;
    },
    set_initial_state: (id: string) => { _currentState = id; _history.push(id); _dataVersion++; },
    set_guard: (key: string, guard: string) => {
      const t = _transitions.get(key);
      if (t) t.guards.push(guard);
      _dataVersion++;
    },
    send_event: (event: string) => {
      const key = transitionKey(_currentState, event);
      const t = _transitions.get(key);
      if (!t) return;
      if (t.guards.length > 0) {
        _pendingGuard = t.guards[0];
      } else {
        _currentState = t.to;
        _history.push(t.to);
        _transitionCount++;
      }
      _dataVersion++;
    },
    resolve_guard: (allowed: boolean) => {
      if (!_pendingGuard) return;
      _pendingGuard = '';
      if (allowed) {
        // Find the transition that was guarded and complete it
        _transitionCount++;
      }
      _dataVersion++;
    },
    set_context: (json: string) => { _context = json; _dataVersion++; },
    merge_context: (json: string) => {
      const existing = JSON.parse(_context);
      const incoming = JSON.parse(json);
      _context = JSON.stringify({ ...existing, ...incoming });
      _dataVersion++;
    },
    get_state_machine_state: () => ({
      currentState: _currentState,
      pendingGuard: _pendingGuard,
      transitionCount: _transitionCount,
      availableEventCount: 0,
      stateCount: _states.size,
      historyLength: _history.length,
    }),
    can_send: (event: string) => _transitions.has(transitionKey(_currentState, event)),
    get_available_event: (_index: number) => '',
    get_on_enter_action: (_stateId: string) => '',
    get_on_exit_action: (_stateId: string) => '',
    is_in_state: (stateId: string) => _currentState === stateId,
    context_json: () => _context,
    state_history: (index: number) => {
      const i = _history.length - 1 - index;
      return i >= 0 ? _history[i] : '';
    },
    data_version: () => _dataVersion,
    reset: () => {
      _currentState = ''; _pendingGuard = ''; _transitionCount = 0;
      _context = '{}'; _history.length = 0;
      _dataVersion++;
    },
  } as IStateMachineEngine;
}
```

Use `renderHook` from `@testing-library/react` to test hooks in isolation. The state machine engine hooks follow the same testing patterns as `useWasmState` and `useWasmSelector`.
