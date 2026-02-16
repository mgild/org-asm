# CommandPalette Engine Pattern

Rust-owned command palette with fuzzy search, keybinding resolution, and execution tracking. The WASM engine owns ALL palette state -- command registry, fuzzy search scoring, keybinding normalization and lookup, execution counts, pagination. TypeScript is a dumb palette renderer that dispatches commands and reads search results back.

## When to Use

Use the command palette engine when your app has:
- A command palette (Ctrl+K / Cmd+K style)
- Fuzzy search over registered commands
- Keyboard shortcuts that resolve to commands
- Execution history with recency-boosted ranking
- Paginated command results

NOT for simple dropdown menus or static button lists.

## Quick Start

### 1. Implement ICommandPaletteEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/commandpalette-engine-template.rs crates/my-engine/src/commandpalette.rs
```

Customize:
1. **`init_commands()`** -- register your app's commands
2. **Scoring** -- adjust fuzzy match weights and recency boost

### 2. Wire with React Hooks

```tsx
import { useCommandPaletteEngine, useCommandPaletteState, useCommandPaletteResult } from 'org-asm/react';

function CommandPalette() {
  const engine = useMemo(() => new MyCommandPaletteEngine(), []);
  const handle = useCommandPaletteEngine(engine);

  useEffect(() => {
    if (!handle) return;
    handle.registerCommand('save', 'Save File', 'File', 'cmd+s');
    handle.registerCommand('open', 'Open File', 'File', 'cmd+o');
    handle.registerCommand('find', 'Find in Files', 'Search', 'cmd+shift+f');
    handle.registerCommand('toggle-sidebar', 'Toggle Sidebar', 'View', 'cmd+b');
  }, [handle]);

  return (
    <div>
      <PaletteInput handle={handle} />
      <ResultList handle={handle} />
    </div>
  );
}

function PaletteInput({ handle }: { handle: CommandPaletteHandle | null }) {
  const { query, resultCount } = useCommandPaletteState(handle);
  return (
    <div>
      <input
        value={query}
        onChange={e => handle?.setQuery(e.target.value)}
        placeholder="Type a command..."
      />
      <span>{resultCount} commands</span>
    </div>
  );
}

function ResultList({ handle }: { handle: CommandPaletteHandle | null }) {
  const { resultCount } = useCommandPaletteState(handle);
  return (
    <ul>
      {Array.from({ length: Math.min(resultCount, 10) }, (_, i) => (
        <ResultRow key={i} handle={handle} index={i} />
      ))}
    </ul>
  );
}

function ResultRow({ handle, index }: { handle: CommandPaletteHandle | null; index: number }) {
  const { id, label, category, keybinding, score } = useCommandPaletteResult(handle, index);
  if (!id) return null;
  return (
    <li onClick={() => handle?.markExecuted(id)}>
      <span className="category">{category}</span>
      <span className="label">{label}</span>
      {keybinding && <kbd>{keybinding}</kbd>}
    </li>
  );
}
```

### 3. Keybinding Resolution

```tsx
useEffect(() => {
  if (!handle) return;
  const handler = (e: KeyboardEvent) => {
    const combo = buildKeyCombo(e); // e.g. "cmd+shift+f"
    const commandId = handle.resolveKeybinding(combo);
    if (commandId) {
      e.preventDefault();
      handle.markExecuted(commandId);
      executeCommand(commandId);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [handle]);
```

### 4. Context (optional)

```tsx
import { createCommandPaletteContext } from 'org-asm/react';

const { CommandPaletteProvider, useCommandPalette, useCommandPaletteStatus, useCommandPaletteResult } =
  createCommandPaletteContext<MyEngine>();
```

## ICommandPaletteEngine Contract

### Registration

| Method | Description |
|--------|-------------|
| `register_command(id, label, category, keybinding)` | Register a command |
| `unregister_command(id)` | Remove a command |
| `command_count()` | Number of registered commands |
| `command_id(index)` | Get command ID by index |
| `command_label(id)` | Get command label |
| `command_category(id)` | Get command category |

### Enabled State

| Method | Description |
|--------|-------------|
| `set_enabled(id, enabled)` | Enable/disable a command |
| `is_enabled(id)` | Check if command is enabled |

### Search

| Method | Description |
|--------|-------------|
| `set_query(text)` | Set fuzzy search query |
| `query()` | Get current query |
| `result_count()` | Number of matching results |
| `result_id(index)` | Result command ID at index |
| `result_label(index)` | Result label at index |
| `result_category(index)` | Result category at index |
| `result_score(index)` | Result match score at index |

### Keybindings

| Method | Description |
|--------|-------------|
| `resolve_keybinding(key_combo)` | Find command for a key combo |
| `keybinding(command_id)` | Get keybinding for a command |
| `set_keybinding(command_id, keybinding)` | Set/change keybinding |

### Execution

| Method | Description |
|--------|-------------|
| `mark_executed(id)` | Record command execution (boosts future ranking) |
| `last_executed_id()` | Get the most recently executed command |
| `execution_count(id)` | Get execution count for a command |

### Pagination

| Method | Description |
|--------|-------------|
| `set_page(page)` | Set current page (0-based) |
| `set_page_size(size)` | Set results per page (default: 50) |
| `page()` / `page_size()` / `page_count()` | Read pagination state |

## Fuzzy Matching Algorithm

The engine uses subsequence matching with scoring:

1. For each character in the query, find next occurrence in the label (case-insensitive)
2. Score = matches / query_length
3. Gap penalty: subtract 0.01 per character gap between matches
4. Recency boost: add execution_count * 0.1 (capped at 1.0)
5. Results sorted by score descending

## Keybinding Normalization

Keybindings are normalized before storage and lookup:
- Lowercased
- Modifiers sorted alphabetically: alt, cmd, ctrl, shift
- Synonyms mapped: `cmd` = `meta`, `ctrl` = `control`

Example: `Shift+Cmd+F` normalizes to `cmd+f+shift`

## Types

### CommandPaletteState

```typescript
interface CommandPaletteState {
  commandCount: number;
  query: string;
  resultCount: number;
  page: number;
  pageSize: number;
  pageCount: number;
  lastExecutedId: string;
  dataVersion: number;
}
```

### CommandPaletteResult

```typescript
interface CommandPaletteResult {
  index: number;
  id: string;
  label: string;
  category: string;
  score: number;
  isEnabled: boolean;
  keybinding: string;
}
```
