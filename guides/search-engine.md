# Search Engine Pattern

Rust-owned client-side search and filtering with faceted search, pagination, and sorting. The WASM engine owns ALL search state -- query, filters, sort, pagination, facet computation, result indices. TypeScript is a dumb dispatcher that triggers search mutations and reads result state back.

## When to Use

Use the search engine when your app has:
- Client-side search with text queries and structured filters
- Faceted navigation (category counts, price ranges, tag filters)
- Paginated results with configurable page sizes
- Sort by multiple fields with direction control

NOT for server-side search proxying or simple `Array.filter()`. For those, use `useWasmCall` with a filter function.

## Quick Start

### 1. Implement ISearchEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/search-engine-template.rs crates/my-engine/src/search.rs
```

Customize two things:

1. **Item schema** in `load_items()` -- define how your data is parsed and indexed
2. **Facet definitions** -- configure which fields produce facet counts

```rust
fn load_items(&mut self, json: &str) {
    let items: Vec<SearchItem> = serde_json::from_str(json).unwrap_or_default();
    self.items = items;
    self.dirty = true;
    self.data_version += 1;
}
```

### 2. Wire with React Hooks

```tsx
import { useSearchEngine, useSearchState, useSearchResult } from 'org-asm/react';

function ProductSearch() {
  const engine = useMemo(() => new MySearchEngine(), []);
  const handle = useSearchEngine(engine);

  // Load items on mount
  useEffect(() => {
    if (!handle) return;
    fetch('/api/products').then(r => r.json()).then(data => {
      handle.loadItems(JSON.stringify(data));
      handle.setSearchFields(JSON.stringify(['name', 'description', 'tags']));
    });
  }, [handle]);

  return (
    <div>
      <SearchBar handle={handle} />
      <FilterSidebar handle={handle} />
      <ResultList handle={handle} />
      <Pagination handle={handle} />
    </div>
  );
}

function SearchBar({ handle }: { handle: SearchHandle | null }) {
  const { query } = useSearchState(handle);
  return (
    <input
      value={query}
      onChange={e => handle?.setQuery(e.target.value)}
      placeholder="Search products..."
    />
  );
}

function FilterSidebar({ handle }: { handle: SearchHandle | null }) {
  const categoryCount = handle?.getFacetCount('category') ?? 0;
  const categories = Array.from({ length: categoryCount }, (_, i) =>
    handle?.getFacetValue('category', i) ?? ''
  );

  return (
    <div>
      <h3>Categories</h3>
      {categories.map(cat => (
        <label key={cat}>
          <input
            type="checkbox"
            onChange={e => {
              if (e.target.checked) handle?.addFilter(JSON.stringify({ field: 'category', op: 'eq', value: cat }));
              else handle?.removeFilter(JSON.stringify({ field: 'category', value: cat }));
            }}
          />
          {cat} ({handle?.getFacetItemCount('category', cat) ?? 0})
        </label>
      ))}
    </div>
  );
}

function ResultList({ handle }: { handle: SearchHandle | null }) {
  const { resultCount } = useSearchState(handle);
  return (
    <ul>
      {Array.from({ length: resultCount }, (_, i) => (
        <ResultItem key={i} handle={handle} index={i} />
      ))}
    </ul>
  );
}

function ResultItem({ handle, index }: { handle: SearchHandle | null; index: number }) {
  const { id, exists } = useSearchResult(handle, index);
  if (!exists) return null;
  const name = handle?.getResultValue(index, 'name') ?? '';
  const price = handle?.getResultValue(index, 'price') ?? '';
  return <li>{name} - ${price}</li>;
}

function Pagination({ handle }: { handle: SearchHandle | null }) {
  const { page, pageCount } = useSearchState(handle);
  return (
    <div>
      <button disabled={page <= 0} onClick={() => handle?.setPage(page - 1)}>Prev</button>
      <span>Page {page + 1} of {pageCount}</span>
      <button disabled={page >= pageCount - 1} onClick={() => handle?.setPage(page + 1)}>Next</button>
    </div>
  );
}
```

### 3. Context (optional -- no prop drilling)

```tsx
import { createSearchContext } from 'org-asm/react';

const { SearchProvider, useSearch, useSearchStatus, useSearchResult } = createSearchContext<MySearchEngine>();

function App() {
  const engine = useMemo(() => new MySearchEngine(), []);
  return (
    <SearchProvider engine={engine}>
      <ProductSearch />
    </SearchProvider>
  );
}

function SearchInput() {
  const { setQuery } = useSearch();
  const { query } = useSearchStatus();
  return <input value={query} onChange={e => setQuery(e.target.value)} />;
}

function Result({ index }: { index: number }) {
  const { id, exists } = useSearchResult(index);
  if (!exists) return null;
  return <div>Result: {id}</div>;
}
```

## ISearchEngine Contract

### Data Loading

| Method | Type | Description |
|--------|------|-------------|
| `load_items(json)` | `&mut self` | Load searchable items from JSON array, mark dirty, bump version |
| `clear_items()` | `&mut self` | Remove all items, mark dirty, bump version |

### Query

| Method | Type | Description |
|--------|------|-------------|
| `set_query(query)` | `&mut self` | Set text search query, mark dirty, bump version |
| `set_search_fields(json)` | `&mut self` | Set which fields to search (JSON array of strings), mark dirty, bump version |

### Filters

| Method | Type | Description |
|--------|------|-------------|
| `add_filter(json)` | `&mut self` | Add a filter (field, op, value), mark dirty, bump version |
| `remove_filter(json)` | `&mut self` | Remove a filter by field+value, mark dirty, bump version |
| `clear_filters()` | `&mut self` | Remove all filters, mark dirty, bump version |

### Sort

| Method | Type | Description |
|--------|------|-------------|
| `set_sort(field, direction)` | `&mut self` | Set sort field and direction ("asc" or "desc"), mark dirty, bump version |
| `clear_sort()` | `&mut self` | Remove sort, mark dirty, bump version |

### Pagination

| Method | Type | Description |
|--------|------|-------------|
| `set_page(page)` | `&mut self` | Set current page (0-indexed), bump version |
| `set_page_size(size)` | `&mut self` | Set results per page, mark dirty, bump version |

### State

| Method | Type | Description |
|--------|------|-------------|
| `get_search_state()` | `&self` | Full snapshot as SearchState (triggers recomputation if dirty) |
| `data_version()` | `&self` | Monotonically increasing change counter |
| `reset()` | `&mut self` | Reset all state to defaults (no query, no filters, page 0) |

### Result Reads

| Method | Type | Description |
|--------|------|-------------|
| `get_result_id(index)` | `&self` | ID of the result at page-relative index (empty if out of bounds) |
| `get_result_value(index, field)` | `&self` | Field value of the result at page-relative index |

### Facets

| Method | Type | Description |
|--------|------|-------------|
| `get_facet_count(field)` | `&self` | Number of distinct values for a facet field |
| `get_facet_value(field, index)` | `&self` | The facet value at index for a field |
| `get_facet_item_count(field, value)` | `&self` | Number of items matching a specific facet value |

## Lazy Recomputation via Dirty Flag

The search engine uses a dirty flag to avoid recomputing results on every mutation. Mutations (setQuery, addFilter, setSort, etc.) mark the engine as dirty. Results are recomputed lazily when state is read:

```
setQuery("laptop")     → dirty = true, version++
addFilter({...})       → dirty = true, version++
getSearchState()       → if dirty: recompute → dirty = false → return state
```

This means multiple rapid mutations (typing a query while toggling filters) only trigger one recomputation when the result is actually read by React.

## Filter Operations

Filters use the `FilterOp` enum:

| Op | Description | Example |
|----|-------------|---------|
| `eq` | Exact match | `{ field: "category", op: "eq", value: "electronics" }` |
| `neq` | Not equal | `{ field: "status", op: "neq", value: "archived" }` |
| `gt` | Greater than | `{ field: "price", op: "gt", value: "100" }` |
| `gte` | Greater than or equal | `{ field: "price", op: "gte", value: "50" }` |
| `lt` | Less than | `{ field: "price", op: "lt", value: "500" }` |
| `lte` | Less than or equal | `{ field: "rating", op: "lte", value: "3" }` |
| `contains` | Substring match | `{ field: "tags", op: "contains", value: "sale" }` |

## Types

### SearchState

```typescript
interface SearchState {
  query: string;               // Current text query
  resultCount: number;         // Total matching results (across all pages)
  page: number;                // Current page (0-indexed)
  pageSize: number;            // Results per page
  pageCount: number;           // Total number of pages
  sortField: string;           // Current sort field (empty if unsorted)
  sortDirection: string;       // "asc" or "desc" (empty if unsorted)
  filterCount: number;         // Number of active filters
}
```

### SearchResult

```typescript
interface SearchResult {
  id: string;                  // Result item ID
  exists: boolean;             // Whether a result exists at this index
}
```

## Testing

Mock the engine in tests with a plain JS object:

```typescript
function createMockSearchEngine(): ISearchEngine {
  let _query = '';
  let _page = 0;
  let _pageSize = 10;
  let _sortField = '';
  let _sortDirection = '';
  let _dataVersion = 0;
  let _dirty = false;
  const _items: Record<string, string>[] = [];
  const _filters: { field: string; op: string; value: string }[] = [];
  const _searchFields: string[] = [];

  return {
    load_items: (json: string) => {
      _items.length = 0;
      _items.push(...JSON.parse(json));
      _dirty = true; _dataVersion++;
    },
    clear_items: () => { _items.length = 0; _dirty = true; _dataVersion++; },
    set_query: (query: string) => { _query = query; _dirty = true; _dataVersion++; },
    set_search_fields: (json: string) => {
      _searchFields.length = 0;
      _searchFields.push(...JSON.parse(json));
      _dirty = true; _dataVersion++;
    },
    add_filter: (json: string) => { _filters.push(JSON.parse(json)); _dirty = true; _dataVersion++; },
    remove_filter: (json: string) => {
      const f = JSON.parse(json);
      const idx = _filters.findIndex(x => x.field === f.field && x.value === f.value);
      if (idx >= 0) _filters.splice(idx, 1);
      _dirty = true; _dataVersion++;
    },
    clear_filters: () => { _filters.length = 0; _dirty = true; _dataVersion++; },
    set_sort: (field: string, direction: string) => { _sortField = field; _sortDirection = direction; _dirty = true; _dataVersion++; },
    clear_sort: () => { _sortField = ''; _sortDirection = ''; _dirty = true; _dataVersion++; },
    set_page: (page: number) => { _page = page; _dataVersion++; },
    set_page_size: (size: number) => { _pageSize = size; _dirty = true; _dataVersion++; },
    get_search_state: () => ({
      query: _query,
      resultCount: _items.length,
      page: _page,
      pageSize: _pageSize,
      pageCount: Math.ceil(_items.length / _pageSize),
      sortField: _sortField,
      sortDirection: _sortDirection,
      filterCount: _filters.length,
    }),
    get_result_id: (index: number) => {
      const i = _page * _pageSize + index;
      return i < _items.length ? (_items[i].id ?? '') : '';
    },
    get_result_value: (index: number, field: string) => {
      const i = _page * _pageSize + index;
      return i < _items.length ? (_items[i][field] ?? '') : '';
    },
    get_facet_count: (_field: string) => 0,
    get_facet_value: (_field: string, _index: number) => '',
    get_facet_item_count: (_field: string, _value: string) => 0,
    data_version: () => _dataVersion,
    reset: () => {
      _query = ''; _page = 0; _pageSize = 10;
      _sortField = ''; _sortDirection = '';
      _filters.length = 0; _items.length = 0;
      _dirty = false; _dataVersion++;
    },
  } as ISearchEngine;
}
```

Use `renderHook` from `@testing-library/react` to test hooks in isolation. The search engine hooks follow the same testing patterns as `useWasmState` and `useWasmSelector`.
