# Data Table Engine Pattern

Rust-owned data table state with server-side pagination, sorting, filtering, row selection, cell editing, and grouping. The WASM engine owns ALL table state. TypeScript is a dumb row renderer that dispatches user actions and reads state back.

## When to Use

Use the data table engine when your table has:
- Server-side paginated data where the server returns FlatBuffer pages
- Column sorting, per-column filtering, row selection, inline cell editing
- Grouping/aggregation by column
- Full table state management with zero JS-side duplication

NOT for simple static lists or client-side-only tables. For those, use `useWasmState` / `useWasmSelector` with a flat snapshot.

## Quick Start

### 1. Implement ITableEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/table-engine-template.rs crates/my-engine/src/table.rs
```

Customize two things:

1. **Field registration** in `validate_cell()` -- add a match arm for each editable column
2. **Column-specific validation logic** -- use chainable validators from `shared/validation-template.rs`

```rust
fn validate_cell(&self, _row_index: usize, column: &str, value: &str) -> Result<(), String> {
    match column {
        "email" => validate(value).required().email().finish(),
        "age"   => validate(value).required().positive_f64().range_f64(1.0, 150.0).finish(),
        "name"  => validate(value).required().min_length(2).max_length(100).finish(),
        _ => Ok(()),
    }
}
```

### 2. Wire with React Hooks

```tsx
import { useTableEngine, useTableState, useTableRow, useTableCell } from 'org-asm/react';

function MyTable() {
  const engine = useMemo(() => new MyTableEngine(), []);
  const handle = useTableEngine(engine, wasmMemory);
  const { page, pageCount, sortColumn, sortDirection } = useTableState(handle);

  // Two-phase fetch protocol
  useEffect(() => {
    if (!handle?.needsFetch()) return;
    const desc = JSON.parse(handle.queryDescriptor());
    handle.acknowledgeFetch();
    fetchPage(desc).then(({ bytes, total }) => handle.ingestPage(bytes, total));
  }, [handle?.needsFetch()]);

  return (
    <table>
      <thead>
        <tr>
          <th onClick={() => handle?.toggleSort('name')}>Name</th>
          <th onClick={() => handle?.toggleSort('email')}>Email</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: handle?.engine.row_count() ?? 0 }, (_, i) => (
          <TableRow key={i} handle={handle} rowIndex={i} />
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>
            <button disabled={page === 0} onClick={() => handle?.setPage(page - 1)}>Prev</button>
            <span>Page {page + 1} of {pageCount}</span>
            <button disabled={page >= pageCount - 1} onClick={() => handle?.setPage(page + 1)}>Next</button>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function TableRow({ handle, rowIndex }: { handle: TableHandle | null; rowIndex: number }) {
  const { selected } = useTableRow(handle, rowIndex);
  return (
    <tr className={selected ? 'selected' : ''}>
      <td><input type="checkbox" checked={selected} onChange={() => handle?.toggleRow(rowIndex)} /></td>
      <EditableCell handle={handle} rowIndex={rowIndex} column="name" />
      <EditableCell handle={handle} rowIndex={rowIndex} column="email" />
    </tr>
  );
}

function EditableCell({ handle, rowIndex, column }: { handle: TableHandle | null; rowIndex: number; column: string }) {
  const { value, error, dirty } = useTableCell(handle, rowIndex, column);
  return (
    <td className={dirty ? 'dirty' : ''}>
      <input value={value} onChange={e => handle?.setEditValue(rowIndex, column, e.target.value)} />
      {error && <span className="error">{error}</span>}
    </td>
  );
}
```

### 3. Context (optional -- no prop drilling)

```tsx
import { createTableContext } from 'org-asm/react';

const { TableProvider, useTable, useRow, useCell, useTableStatus } = createTableContext<MyTableEngine>();

function App() {
  const engine = useMemo(() => new MyTableEngine(), []);
  return (
    <TableProvider engine={engine} wasmMemory={memory}>
      <MyTable />
    </TableProvider>
  );
}

function TableRow({ rowIndex }: { rowIndex: number }) {
  const { toggleRow } = useTable();
  const { selected } = useRow(rowIndex);
  return (
    <tr className={selected ? 'selected' : ''}>
      <td><input type="checkbox" checked={selected} onChange={() => toggleRow(rowIndex)} /></td>
      <EditableCell rowIndex={rowIndex} column="name" />
    </tr>
  );
}

function EditableCell({ rowIndex, column }: { rowIndex: number; column: string }) {
  const { setEditValue } = useTable();
  const { value, error, dirty } = useCell(rowIndex, column);
  return (
    <td className={dirty ? 'dirty' : ''}>
      <input value={value} onChange={e => setEditValue(rowIndex, column, e.target.value)} />
      {error && <span className="error">{error}</span>}
    </td>
  );
}
```

## ITableEngine Contract

### Page Data

| Method | Type | Description |
|--------|------|-------------|
| `page_ptr()` | `&self` | Pointer to FlatBuffer bytes in WASM memory |
| `page_len()` | `&self` | Byte length of current page data |
| `row_count()` | `&self` | Number of rows in the current page |
| `total_row_count()` | `&self` | Total rows across all pages (from server) |
| `ingest_page(bytes, total)` | `&mut self` | Store page data, clear needs_fetch, bump version |

### Pagination

| Method | Type | Description |
|--------|------|-------------|
| `page()` | `&self` | Current page index (0-based) |
| `page_size()` | `&self` | Rows per page |
| `page_count()` | `&self` | Total number of pages |
| `set_page(page)` | `&mut self` | Navigate to page, set needs_fetch |
| `set_page_size(size)` | `&mut self` | Change page size, reset to page 0, set needs_fetch |

### Sort

| Method | Type | Description |
|--------|------|-------------|
| `sort_column()` | `&self` | Current sort column (empty = no sort) |
| `sort_direction()` | `&self` | 0=none, 1=asc, 2=desc |
| `set_sort(column, direction)` | `&mut self` | Set sort explicitly, set needs_fetch |
| `toggle_sort(column)` | `&mut self` | Cycle: none -> asc -> desc -> none, set needs_fetch |

### Filter

| Method | Type | Description |
|--------|------|-------------|
| `filter_value(column)` | `&self` | Current filter for a column (empty = no filter) |
| `set_filter(column, value)` | `&mut self` | Set filter, reset to page 0, set needs_fetch |
| `clear_filters()` | `&mut self` | Remove all filters, reset to page 0, set needs_fetch |

### Selection

| Method | Type | Description |
|--------|------|-------------|
| `is_row_selected(row_index)` | `&self` | Whether a row is selected |
| `select_row(row_index)` | `&mut self` | Add row to selection |
| `deselect_row(row_index)` | `&mut self` | Remove row from selection |
| `toggle_row(row_index)` | `&mut self` | Toggle row selection |
| `select_all()` | `&mut self` | Select all rows on current page |
| `deselect_all()` | `&mut self` | Clear all selections |
| `selected_count()` | `&self` | Number of selected rows |
| `all_selected()` | `&self` | Whether all rows on current page are selected |

### Cell Editing

| Method | Type | Description |
|--------|------|-------------|
| `is_editable()` | `&self` | Whether editing is enabled |
| `edit_value(row, column)` | `&self` | Edit overlay value (or empty if no edit) |
| `set_edit_value(row, column, value)` | `&mut self` | Set edit overlay, run validation |
| `cell_error(row, column)` | `&self` | Validation error (empty = valid) |
| `is_cell_dirty(row, column)` | `&self` | Whether cell has a pending edit |
| `has_edits()` | `&self` | Whether any cells have pending edits |
| `commit_edits()` | `&mut self` | Serialize dirty cells as JSON, clear overlays |
| `discard_edits()` | `&mut self` | Clear all edit overlays and errors |

### Grouping / Aggregation

| Method | Type | Description |
|--------|------|-------------|
| `group_by_column()` | `&self` | Current group-by column (empty = not grouped) |
| `set_group_by(column)` | `&mut self` | Set group-by column, set needs_fetch |
| `clear_group_by()` | `&mut self` | Clear grouping, set needs_fetch |
| `group_count()` | `&self` | Number of groups in current page |
| `group_label(index)` | `&self` | Display label for a group |
| `group_row_count(index)` | `&self` | Aggregation data for a group (JSON) |
| `is_group_expanded(index)` | `&self` | Whether a group is expanded |
| `toggle_group(index)` | `&mut self` | Toggle group expand/collapse |

### Query Descriptor

| Method | Type | Description |
|--------|------|-------------|
| `needs_fetch()` | `&self` | Whether the TS side should fetch new data |
| `acknowledge_fetch()` | `&mut self` | Clear the needs_fetch flag |
| `query_descriptor()` | `&self` | JSON descriptor of current query state |

### State

| Method | Type | Description |
|--------|------|-------------|
| `data_version()` | `&self` | Monotonically increasing change counter |
| `reset()` | `&mut self` | Reset all state to defaults |

## Zero-Copy Page Buffer

The `getPageBuffer()` method on `TableHandle` creates a `Uint8Array` view directly into WASM linear memory. No copy -- the bytes are read in place.

```ts
const buffer = handle.getPageBuffer();
if (buffer) {
  const table = MyTable.getRootAsMyTable(new ByteBuffer(buffer));
}
```

**Warning:** WASM memory growth invalidates all existing views. If your engine allocates during `ingest_page()` (which it does -- `page_data = bytes.to_vec()`), recreate the view after each ingest. The `useTableState` hook handles this automatically by reading `dataVersion` which bumps after ingest.

## Server-Side Pagination (Two-Phase Fetch Protocol)

The table engine uses a two-phase protocol to coordinate client state with server data:

1. **User action** (sort/filter/page change) -- engine sets `needs_fetch=true` and bumps `data_version`
2. **TypeScript reads** `query_descriptor()` -- JSON with page, page_size, sort, filters, group_by
3. **TypeScript fetches** from server using those parameters
4. **TypeScript calls** `ingest_page(bytes, total_rows)` with the response
5. **Engine sets** `needs_fetch=false` and bumps `data_version` again

```ts
// The canonical fetch loop
useEffect(() => {
  if (!handle?.needsFetch()) return;
  const desc = JSON.parse(handle.queryDescriptor());
  handle.acknowledgeFetch();
  fetchPage(desc).then(({ bytes, total }) => handle.ingestPage(bytes, total));
}, [handle?.needsFetch()]);
```

The `query_descriptor()` returns JSON like:

```json
{
  "page": 0,
  "page_size": 25,
  "sort_column": "name",
  "sort_direction": 1,
  "filters": {"status": "active", "role": "admin"},
  "group_by": ""
}
```

Map `sort_direction` values: 0=none, 1=asc, 2=desc (matches `SortDirection` enum).

## Sorting & Filtering

### Sorting

`toggle_sort(column)` cycles through three states:

```
none -> asc -> desc -> none
```

If a different column is clicked, it starts at `asc`. All sort changes reset `needs_fetch=true` so the server re-sorts.

```ts
// Column header click handler
<th onClick={() => handle?.toggleSort('price')}>
  Price {sortColumn === 'price' ? (sortDirection === 1 ? '^' : 'v') : ''}
</th>
```

### Filtering

`set_filter(column, value)` stores a per-column filter. Empty value removes the filter. All filter changes reset to page 0 and set `needs_fetch=true`.

```ts
// Filter input
<input
  placeholder="Filter by name..."
  onChange={e => handle?.setFilter('name', e.target.value)}
/>

// Clear all filters
<button onClick={() => handle?.clearFilters()}>Clear Filters</button>
```

## Row Selection

Per-row selection state with bulk operations:

```ts
// Per-row: toggle via checkbox
handle.toggleRow(rowIndex);

// Bulk: select/deselect all visible rows
handle.selectAll();
handle.deselectAll();

// Query selection state
const count = handle.engine.selected_count();
const allSelected = handle.engine.all_selected();
const isSelected = handle.engine.is_row_selected(rowIndex);
```

The `useTableRow(handle, rowIndex)` hook subscribes per-row via `useWasmSelector`. Only the toggled row's component re-renders -- other rows remain untouched thanks to structural equality.

## Cell Editing

### Edit Overlay

Edits are stored as overlays -- the original FlatBuffer data is never modified. `set_edit_value()` stores the new value and runs `validate_cell()`.

```ts
// Start editing
handle.setEditValue(rowIndex, 'price', '42.50');

// Read the overlay value (or empty if no edit)
const { value, error, dirty } = useTableCell(handle, rowIndex, 'price');
```

### Validation

`validate_cell()` dispatches per column in Rust. Errors are stored per cell:

```rust
fn validate_cell(&self, _row_index: usize, column: &str, value: &str) -> Result<(), String> {
    match column {
        "price" => validate(value).required().positive_f64().finish(),
        "email" => validate(value).required().email().finish(),
        _ => Ok(()),
    }
}
```

### Commit

`commit_edits()` serializes all dirty cells as JSON and clears the overlay:

```ts
const json = handle.commitEdits();
// json: {"edits":[{"row":0,"column":"price","value":"42.50"},{"row":2,"column":"name","value":"Alice"}]}
await fetch('/api/update', { method: 'POST', body: json });
```

### Discard

`discard_edits()` clears all edit overlays and errors without sending anything:

```ts
handle.discardEdits();
```

## Grouping & Aggregation

Group rows by a column value:

```ts
// Enable grouping
handle.setGroupBy('category');

// Query groups
const { groupByColumn, groupCount } = useTableState(handle);

// Render groups
for (let i = 0; i < groupCount; i++) {
  const label = handle.engine.group_label(i);
  const rowData = handle.engine.group_row_count(i);
  const expanded = handle.engine.is_group_expanded(i);

  // Toggle expand/collapse
  handle.toggleGroup(i);
}

// Clear grouping
handle.clearGroupBy();
```

Group count, labels, and row data are derived from the FlatBuffer page data. The template provides placeholder implementations -- replace them with your actual FlatBuffer group metadata extraction.

## Testing

Mock the engine with a plain JS object implementing `ITableEngine`:

```typescript
function createMockTableEngine(): ITableEngine {
  let _page = 0;
  let _pageSize = 25;
  let _totalRows = 100;
  let _sortColumn = '';
  let _sortDirection = 0;
  let _needsFetch = true;
  let _dataVersion = 0;
  const _selected = new Set<number>();
  const _edits = new Map<string, string>();
  const _errors = new Map<string, string>();
  const _filters = new Map<string, string>();

  return {
    page_ptr: () => 0,
    page_len: () => 0,
    row_count: () => Math.min(_pageSize, _totalRows - _page * _pageSize),
    total_row_count: () => _totalRows,
    ingest_page: (_bytes: Uint8Array, total: number) => {
      _totalRows = total;
      _needsFetch = false;
      _dataVersion++;
    },
    page: () => _page,
    page_size: () => _pageSize,
    page_count: () => Math.ceil(_totalRows / _pageSize),
    set_page: (p: number) => { _page = p; _needsFetch = true; _dataVersion++; },
    set_page_size: (s: number) => { _pageSize = s; _page = 0; _needsFetch = true; _dataVersion++; },
    sort_column: () => _sortColumn,
    sort_direction: () => _sortDirection,
    set_sort: (col: string, dir: number) => { _sortColumn = col; _sortDirection = dir; _needsFetch = true; _dataVersion++; },
    toggle_sort: (col: string) => { /* cycle logic */ _dataVersion++; },
    // ... see test files for full mock
    data_version: () => _dataVersion,
    needs_fetch: () => _needsFetch,
    acknowledge_fetch: () => { _needsFetch = false; },
    query_descriptor: () => JSON.stringify({ page: _page, page_size: _pageSize }),
    reset: () => { _dataVersion++; },
  } as ITableEngine;
}
```

Use `renderHook` from `@testing-library/react` to test hooks in isolation. The table engine hooks follow the same testing patterns as `useWasmState` and `useWasmSelector`.

## Context (No Prop Drilling)

```tsx
const { TableProvider, useTable, useRow, useCell, useTableStatus } = createTableContext<MyTableEngine>();

// Root
<TableProvider engine={engine} wasmMemory={memory}>
  <DataTable />
</TableProvider>

// Any descendant
const { toggleSort, setPage } = useTable();
const { selected } = useRow(3);
const { value, error } = useCell(3, 'price');
const { page, pageCount } = useTableStatus();
```
