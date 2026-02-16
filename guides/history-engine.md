# History Engine Pattern

Rust-owned undo/redo state with opaque JSON commands, checkpoints, and bounded capacity. The WASM engine owns ALL history state -- undo/redo stacks, labels, capacity limits, checkpoint boundaries. TypeScript is a dumb dispatcher that pushes commands and reads returned JSON to apply reversals.

## When to Use

Use the history engine when your app has:
- Undo/redo functionality for user actions (editors, drawing tools, form wizards)
- Complex state mutations that need reversible tracking
- Checkpoint/milestone support for grouping related changes
- Bounded history with configurable capacity limits

NOT for simple single-field undo (use browser native `Ctrl+Z`). For those, no engine is needed.

## Quick Start

### 1. Implement IHistoryEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/history-engine-template.rs crates/my-engine/src/history.rs
```

The template works out of the box for opaque JSON commands. No customization needed unless you want custom validation of command payloads.

### 2. Wire with React Hooks

```tsx
import { useHistoryEngine, useHistoryState, useUndoEntry, useRedoEntry } from 'org-asm/react';

function Editor() {
  const engine = useMemo(() => new MyHistoryEngine(), []);
  const handle = useHistoryEngine(engine);

  const addItem = (item: Item) => {
    applyAdd(item); // mutate your app state
    handle?.pushCommand(JSON.stringify({
      type: 'add_item',
      label: `Add ${item.name}`,
      forward: { action: 'add', item },
      reverse: { action: 'remove', itemId: item.id },
    }));
  };

  return (
    <div>
      <UndoRedoToolbar handle={handle} />
      <Canvas onAddItem={addItem} />
    </div>
  );
}

function UndoRedoToolbar({ handle }: { handle: HistoryHandle | null }) {
  const { canUndo, canRedo, undoCount, redoCount } = useHistoryState(handle);

  const undo = () => {
    const json = handle?.undo();
    if (json) applyReverse(JSON.parse(json)); // your reversal logic
  };

  const redo = () => {
    const json = handle?.redo();
    if (json) applyForward(JSON.parse(json)); // your forward logic
  };

  return (
    <div>
      <button disabled={!canUndo} onClick={undo}>
        Undo ({undoCount})
      </button>
      <button disabled={!canRedo} onClick={redo}>
        Redo ({redoCount})
      </button>
    </div>
  );
}

function UndoPreview({ handle }: { handle: HistoryHandle | null }) {
  const entry = useUndoEntry(handle, 0);
  return entry ? <span>Undo: {entry.label}</span> : null;
}

function RedoPreview({ handle }: { handle: HistoryHandle | null }) {
  const entry = useRedoEntry(handle, 0);
  return entry ? <span>Redo: {entry.label}</span> : null;
}
```

### 3. Context (optional -- no prop drilling)

```tsx
import { createHistoryContext } from 'org-asm/react';

const { HistoryProvider, useHistory, useHistoryStatus, useUndoItem, useRedoItem } = createHistoryContext<MyHistoryEngine>();

function App() {
  const engine = useMemo(() => new MyHistoryEngine(), []);
  return (
    <HistoryProvider engine={engine}>
      <Editor />
    </HistoryProvider>
  );
}

function UndoButton() {
  const { undo } = useHistory();
  const { canUndo } = useHistoryStatus();
  return <button disabled={!canUndo} onClick={() => {
    const json = undo();
    if (json) applyReverse(JSON.parse(json));
  }}>Undo</button>;
}

function UndoLabel() {
  const entry = useUndoItem(0);
  return entry ? <span>{entry.label}</span> : null;
}

function RedoLabel() {
  const entry = useRedoItem(0);
  return entry ? <span>{entry.label}</span> : null;
}
```

## IHistoryEngine Contract

### Command Stack

| Method | Type | Description |
|--------|------|-------------|
| `push_command(json)` | `&mut self` | Push opaque JSON command onto undo stack, clear redo stack, bump version |
| `push_batch(json_array)` | `&mut self` | Push multiple commands as a single undoable unit, bump version |
| `undo()` | `&mut self` | Pop from undo stack, push to redo stack, return command JSON (empty if nothing to undo) |
| `redo()` | `&mut self` | Pop from redo stack, push to undo stack, return command JSON (empty if nothing to redo) |

### Stack Info

| Method | Type | Description |
|--------|------|-------------|
| `get_history_state()` | `&self` | Full snapshot as HistoryState |
| `last_command()` | `&self` | JSON of most recent undo entry (empty if stack is empty) |
| `undo_label(index)` | `&self` | Label of undo entry at index (0 = most recent, empty if out of bounds) |
| `redo_label(index)` | `&self` | Label of redo entry at index (0 = most recent, empty if out of bounds) |

### Capacity

| Method | Type | Description |
|--------|------|-------------|
| `set_max_history(max)` | `&mut self` | Set maximum undo stack depth, evict oldest if over limit, bump version |

### Checkpoints

| Method | Type | Description |
|--------|------|-------------|
| `checkpoint(label)` | `&mut self` | Mark a checkpoint boundary in the undo stack, bump version |

### Clear

| Method | Type | Description |
|--------|------|-------------|
| `clear_history()` | `&mut self` | Clear both undo and redo stacks, bump version |
| `clear_redo()` | `&mut self` | Clear only the redo stack, bump version |

### State

| Method | Type | Description |
|--------|------|-------------|
| `data_version()` | `&self` | Monotonically increasing change counter |
| `reset()` | `&mut self` | Clear all history, reset capacity to default |

## Key Design: Opaque JSON Commands

The history engine does NOT know how to undo your state changes. It stores opaque JSON blobs. When `undo()` is called, it returns the command JSON. TypeScript reads the JSON and applies the reversal.

This is deliberate -- the engine manages stack ordering, capacity, and checkpoint boundaries. Your app owns the mutation semantics.

### Command JSON Convention

Commands should contain everything needed for both forward and reverse application:

```json
{
  "type": "move_item",
  "label": "Move widget to (100, 200)",
  "forward": { "action": "move", "itemId": "w1", "x": 100, "y": 200 },
  "reverse": { "action": "move", "itemId": "w1", "x": 50, "y": 75 }
}
```

The `label` field is extracted by the engine for `undo_label()` / `redo_label()` display. The `forward` and `reverse` fields are your app's concern.

### Applying Undo/Redo

```ts
function applyCommand(json: string, direction: 'forward' | 'reverse') {
  const cmd = JSON.parse(json);
  const payload = cmd[direction];

  switch (payload.action) {
    case 'add':
      addItemToCanvas(payload.item);
      break;
    case 'remove':
      removeItemFromCanvas(payload.itemId);
      break;
    case 'move':
      moveItem(payload.itemId, payload.x, payload.y);
      break;
  }
}

// On undo: apply the "reverse" direction
const json = handle.undo();
if (json) applyCommand(json, 'reverse');

// On redo: apply the "forward" direction
const json = handle.redo();
if (json) applyCommand(json, 'forward');
```

## Batch Commands

Group multiple commands into a single undoable unit:

```ts
// Moving multiple selected items is one undo step
const commands = selectedItems.map(item => JSON.stringify({
  type: 'move_item',
  label: `Move ${item.name}`,
  forward: { action: 'move', itemId: item.id, x: item.x + dx, y: item.y + dy },
  reverse: { action: 'move', itemId: item.id, x: item.x, y: item.y },
}));

handle.pushBatch(JSON.stringify(commands));
```

When a batch is undone, `undo()` returns a JSON array of all commands in the batch. Apply all reversals:

```ts
const json = handle.undo();
if (json) {
  const commands = JSON.parse(json);
  if (Array.isArray(commands)) {
    commands.reverse().forEach(cmd => applyCommand(JSON.stringify(cmd), 'reverse'));
  } else {
    applyCommand(json, 'reverse');
  }
}
```

## Checkpoints

Checkpoints mark save boundaries. Useful for "revert to last save" functionality:

```ts
// After saving to server
handle.checkpoint('Saved at 2:30 PM');

// The checkpoint label appears in the undo stack
const label = handle.undoLabel(0); // "Saved at 2:30 PM"
```

## Capacity Management

Prevent unbounded memory growth:

```ts
// Limit undo stack to 100 entries
handle.setMaxHistory(100);

// When the 101st command is pushed, the oldest entry is evicted
```

The default capacity is set in the Rust template. Override with `set_max_history()` at initialization.

## Types

### HistoryState

```typescript
interface HistoryState {
  canUndo: boolean;            // undo stack is not empty
  canRedo: boolean;            // redo stack is not empty
  undoCount: number;           // number of entries in undo stack
  redoCount: number;           // number of entries in redo stack
  maxHistory: number;          // current capacity limit
}
```

### CommandEntry

```typescript
interface CommandEntry {
  label: string;               // display label extracted from command JSON
  json: string;                // full opaque command JSON
}
```

## Testing

Mock the engine in tests with a plain JS object:

```typescript
function createMockHistoryEngine(): IHistoryEngine {
  let _dataVersion = 0;
  let _maxHistory = 100;
  const _undoStack: string[] = [];
  const _redoStack: string[] = [];

  const extractLabel = (json: string): string => {
    try { return JSON.parse(json).label ?? ''; } catch { return ''; }
  };

  return {
    push_command: (json: string) => {
      _undoStack.push(json);
      _redoStack.length = 0;
      if (_undoStack.length > _maxHistory) _undoStack.shift();
      _dataVersion++;
    },
    push_batch: (jsonArray: string) => {
      _undoStack.push(jsonArray);
      _redoStack.length = 0;
      if (_undoStack.length > _maxHistory) _undoStack.shift();
      _dataVersion++;
    },
    undo: (): string => {
      const cmd = _undoStack.pop();
      if (cmd) { _redoStack.push(cmd); _dataVersion++; }
      return cmd ?? '';
    },
    redo: (): string => {
      const cmd = _redoStack.pop();
      if (cmd) { _undoStack.push(cmd); _dataVersion++; }
      return cmd ?? '';
    },
    get_history_state: () => ({
      canUndo: _undoStack.length > 0,
      canRedo: _redoStack.length > 0,
      undoCount: _undoStack.length,
      redoCount: _redoStack.length,
      maxHistory: _maxHistory,
    }),
    last_command: () => _undoStack.length > 0 ? _undoStack[_undoStack.length - 1] : '',
    undo_label: (index: number) => {
      const i = _undoStack.length - 1 - index;
      return i >= 0 ? extractLabel(_undoStack[i]) : '';
    },
    redo_label: (index: number) => {
      const i = _redoStack.length - 1 - index;
      return i >= 0 ? extractLabel(_redoStack[i]) : '';
    },
    set_max_history: (max: number) => { _maxHistory = max; _dataVersion++; },
    checkpoint: (_label: string) => { _dataVersion++; },
    clear_history: () => { _undoStack.length = 0; _redoStack.length = 0; _dataVersion++; },
    clear_redo: () => { _redoStack.length = 0; _dataVersion++; },
    data_version: () => _dataVersion,
    reset: () => { _undoStack.length = 0; _redoStack.length = 0; _maxHistory = 100; _dataVersion++; },
  } as IHistoryEngine;
}
```

Use `renderHook` from `@testing-library/react` to test hooks in isolation. The history engine hooks follow the same testing patterns as `useWasmState` and `useWasmSelector`.
