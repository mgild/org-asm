# VirtualScroll Engine Pattern

Rust-owned virtual scroll state for rendering massive lists efficiently. The WASM engine owns ALL scroll state -- viewport dimensions, item heights, scroll offset, visible range computation, scroll-to logic, anchoring. TypeScript is a dumb list renderer that dispatches scroll events and reads visible range / item positions back.

## When to Use

Use the virtual scroll engine when your app has:
- Lists with thousands or millions of items
- Variable-height items that need efficient position computation
- Scroll-to-index functionality with alignment options
- Anchor-based scroll position preservation during content changes

NOT for short lists (<100 items) or simple pagination. For those, use standard rendering.

## Quick Start

### 1. Implement IVirtualScrollEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/virtualscroll-engine-template.rs crates/my-engine/src/virtualscroll.rs
```

Customize:
1. **Default item height** -- set based on your row design
2. **Overscan count** -- extra items rendered above/below viewport for smooth scrolling

### 2. Wire with React Hooks

```tsx
import { useVirtualScrollEngine, useVirtualScrollState, useVirtualScrollItem } from 'org-asm/react';

function VirtualList() {
  const engine = useMemo(() => new MyVirtualScrollEngine(), []);
  const handle = useVirtualScrollEngine(engine);

  useEffect(() => {
    if (!handle) return;
    handle.setViewportHeight(600);
    handle.setDefaultItemHeight(40);
    handle.setOverscanCount(5);
    handle.setItemCount(100000);
  }, [handle]);

  return (
    <div style={{ height: 600, overflow: 'auto' }} onScroll={e => {
      handle?.setScrollOffset(e.currentTarget.scrollTop);
    }}>
      <ScrollContent handle={handle} />
    </div>
  );
}

function ScrollContent({ handle }: { handle: VirtualScrollHandle | null }) {
  const { totalHeight, visibleStart, visibleEnd } = useVirtualScrollState(handle);

  return (
    <div style={{ height: totalHeight, position: 'relative' }}>
      {Array.from({ length: visibleEnd - visibleStart }, (_, i) => (
        <VirtualRow key={visibleStart + i} handle={handle} index={visibleStart + i} />
      ))}
    </div>
  );
}

function VirtualRow({ handle, index }: { handle: VirtualScrollHandle | null; index: number }) {
  const { top, height, isVisible } = useVirtualScrollItem(handle, index);
  if (!isVisible) return null;
  return (
    <div style={{ position: 'absolute', top, height, width: '100%' }}>
      Row {index}
    </div>
  );
}
```

### 3. Context (optional)

```tsx
import { createVirtualScrollContext } from 'org-asm/react';

const { VirtualScrollProvider, useVirtualScroll, useVirtualScrollStatus, useVirtualScrollItem } =
  createVirtualScrollContext<MyEngine>();

function App() {
  const engine = useMemo(() => new MyEngine(), []);
  return (
    <VirtualScrollProvider engine={engine}>
      <VirtualList />
    </VirtualScrollProvider>
  );
}
```

## IVirtualScrollEngine Contract

### Viewport

| Method | Description |
|--------|-------------|
| `set_viewport_height(height)` | Set the visible area height in pixels |
| `set_overscan_count(count)` | Set extra items rendered above/below viewport |
| `viewport_height()` | Get the viewport height |
| `overscan_count()` | Get the overscan count |

### Items

| Method | Description |
|--------|-------------|
| `set_item_count(count)` | Set total number of items |
| `set_item_height(index, height)` | Set per-item height override |
| `set_default_item_height(height)` | Set default height for items without overrides |
| `item_height(index)` | Get the height of an item |
| `default_item_height()` | Get the default item height |
| `item_count()` | Get total number of items |

### Scroll

| Method | Description |
|--------|-------------|
| `set_scroll_offset(offset)` | Set scroll position from top |
| `scroll_offset()` | Get current scroll offset |
| `total_height()` | Get total scrollable height (sum of all item heights) |

### Visible Range

| Method | Description |
|--------|-------------|
| `visible_start()` | First visible item index (including overscan) |
| `visible_end()` | Past-the-end visible item index (including overscan) |
| `visible_count()` | Number of visible items |

### Scroll-To

| Method | Description |
|--------|-------------|
| `scroll_to_index(index)` | Scroll to bring an item to the viewport start |
| `scroll_to_index_aligned(index, align)` | Scroll with alignment: 0=start, 1=center, 2=end |
| `is_index_visible(index)` | Whether an item is currently in the visible range |

### Anchoring

| Method | Description |
|--------|-------------|
| `set_anchor(index)` | Set anchor item for position preservation |
| `anchor()` | Get anchor index (-1 if none) |
| `clear_anchor()` | Remove anchor |
| `anchor_offset_delta()` | Offset change since anchor was set |

## Lazy Recomputation

The engine uses dirty flags to avoid recomputing on every mutation:

```
setItemCount(1000)       → height_dirty = true, range_dirty = true
setScrollOffset(500)     → range_dirty = true
visible_start()          → if dirty: recompute → return cached value
```

## Types

### VirtualScrollState

```typescript
interface VirtualScrollState {
  itemCount: number;
  viewportHeight: number;
  overscanCount: number;
  scrollOffset: number;
  totalHeight: number;
  visibleStart: number;
  visibleEnd: number;
  visibleCount: number;
  defaultItemHeight: number;
  anchor: number;          // -1 if no anchor
  dataVersion: number;
}
```

### VirtualScrollItem

```typescript
interface VirtualScrollItem {
  index: number;
  top: number;
  height: number;
  isVisible: boolean;
}
```

### ScrollAlign

```typescript
enum ScrollAlign { Start = 0, Center = 1, End = 2 }
```
