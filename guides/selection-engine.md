# Selection Engine Pattern

Rust-owned multi-select, range-select, and keyboard navigation state. The WASM engine owns ALL selection state -- items, selected set, focus, anchor, mode, keyboard navigation. TypeScript is a dumb list renderer that dispatches selection actions and reads state back.

## When to Use

Use the selection engine when your app has:
- Selectable lists, grids, or tree views
- Multi-select with Ctrl+click and Shift+click (range select)
- Keyboard navigation (arrow keys, Enter to activate)
- Focus tracking separate from selection
- Select all / deselect all

NOT for single checkboxes or radio buttons. For those, use standard form state.

## Quick Start

### 1. Implement ISelectionEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/selection-engine-template.rs crates/my-engine/src/selection.rs
```

Customize:
1. **`init_selection()`** -- set initial selection mode and items

### 2. Wire with React Hooks

```tsx
import { useSelectionEngine, useSelectionState, useSelectionItem } from 'org-asm/react';

function FileList() {
  const engine = useMemo(() => new MySelectionEngine(), []);
  const handle = useSelectionEngine(engine);

  useEffect(() => {
    if (!handle) return;
    handle.setMode(1); // Multi-select
    handle.setItems(JSON.stringify(['file1', 'file2', 'file3', 'file4']));
  }, [handle]);

  return (
    <div onKeyDown={e => {
      if (e.key === 'ArrowDown') handle?.moveFocus(1);
      if (e.key === 'ArrowUp') handle?.moveFocus(0);
      if (e.key === 'Enter') handle?.activateFocus();
      if (e.key === 'a' && e.ctrlKey) { e.preventDefault(); handle?.selectAll(); }
    }}>
      <SelectionToolbar handle={handle} />
      <FileItem handle={handle} id="file1" />
      <FileItem handle={handle} id="file2" />
      <FileItem handle={handle} id="file3" />
      <FileItem handle={handle} id="file4" />
    </div>
  );
}

function SelectionToolbar({ handle }: { handle: SelectionHandle | null }) {
  const { selectedCount, itemCount } = useSelectionState(handle);
  return (
    <div>
      <span>{selectedCount} of {itemCount} selected</span>
      <button onClick={() => handle?.selectAll()}>Select All</button>
      <button onClick={() => handle?.deselectAll()}>Clear</button>
    </div>
  );
}

function FileItem({ handle, id }: { handle: SelectionHandle | null; id: string }) {
  const { isSelected, isFocused } = useSelectionItem(handle, id);
  return (
    <div
      className={`${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}`}
      onClick={e => {
        if (e.shiftKey) handle?.selectRange(handle.engine.anchor(), id);
        else if (e.ctrlKey || e.metaKey) handle?.toggle(id);
        else handle?.select(id);
      }}
    >
      {id}
    </div>
  );
}
```

### 3. Context (optional)

```tsx
import { createSelectionContext } from 'org-asm/react';

const { SelectionProvider, useSelection, useSelectionStatus, useSelectionItem } =
  createSelectionContext<MyEngine>();
```

## ISelectionEngine Contract

### Mode

| Method | Description |
|--------|-------------|
| `set_mode(mode)` | 0=single (one at a time), 1=multi (toggle), 2=range (shift-click) |
| `mode()` | Get current mode |

### Items

| Method | Description |
|--------|-------------|
| `set_items(json)` | Set items from JSON array of ID strings |
| `add_item(id, index)` | Add item at index |
| `remove_item(id)` | Remove item by ID |
| `clear_items()` | Remove all items |
| `item_count()` | Total items |
| `item_id(index)` | Get item ID at index |
| `item_index(id)` | Get index of item (-1 if not found) |

### Selection

| Method | Description |
|--------|-------------|
| `select(id)` | Select an item (single mode: deselects previous) |
| `deselect(id)` | Deselect an item |
| `toggle(id)` | Toggle selection |
| `select_range(from_id, to_id)` | Select all items between two IDs |
| `select_all()` | Select all items |
| `deselect_all()` | Deselect all |
| `is_selected(id)` | Check if selected |
| `selected_count()` | Number of selected items |
| `selected_id(index)` | Get selected item ID by index |

### Focus & Anchor

| Method | Description |
|--------|-------------|
| `set_focus(id)` | Set focused item |
| `focus()` | Get focused item ID |
| `set_anchor(id)` | Set anchor for range selection |
| `anchor()` | Get anchor item ID |

### Keyboard

| Method | Description |
|--------|-------------|
| `move_focus(direction)` | 0=up, 1=down, 2=left, 3=right |
| `activate_focus()` | Select the focused item |

## Selection Modes

| Mode | Behavior |
|------|----------|
| Single (0) | Only one item selected at a time. `select()` deselects previous. |
| Multi (1) | Multiple items. `toggle()` adds/removes individual items. |
| Range (2) | `select_range()` selects contiguous range from anchor to target. |

## Types

### SelectionState

```typescript
interface SelectionState {
  mode: number;
  itemCount: number;
  selectedCount: number;
  focusId: string;
  anchorId: string;
  dataVersion: number;
}
```

### SelectionItem

```typescript
interface SelectionItem {
  id: string;
  isSelected: boolean;
  isFocused: boolean;
  index: number;
}
```
