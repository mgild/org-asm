// ============================================================================
// VIRTUAL SCROLL ENGINE TEMPLATE — Rust/WASM Client-Side Virtual Scroll State Machine
// ============================================================================
//
// HOW TO USE THIS TEMPLATE:
//
// 1. COPY this file and rename it (e.g., virtualscroll-engine.rs).
//
// 2. THE PATTERN:
//    - JS calls set_item_count(n), set_viewport_height(h), set_scroll_offset(o)
//    - Engine lazily recomputes visible range and total height when state is read (dirty flags)
//    - JS reads results via visible_start(), visible_end(), item_top(index), etc.
//    - Anchoring maintains scroll position during content changes
//
// 3. LAZY RECOMPUTATION:
//    Mutations (set_item_count, set_scroll_offset, set_item_height, etc.) set dirty flags.
//    Reads (visible_start, total_height, etc.) call ensure_range_computed() or
//    ensure_height_computed() if dirty. This avoids redundant computation when
//    multiple mutations happen before a read.
//
// 4. VISIBLE RANGE:
//    Binary search through cumulative heights to find first/last items in viewport.
//    Overscan extends the range by N items above and below the visible area.
//
// 5. SCROLL-TO:
//    scroll_to_index: set offset = item_top(index)
//    scroll_to_index_aligned: Start = item_top, Center = centered, End = bottom-aligned
//
// 6. ANCHORING:
//    set_anchor(index) records an anchor item. anchor_offset_delta() returns the
//    difference between the current and original top of that item, so the caller
//    can adjust scroll position to maintain visual stability.
//
// ============================================================================

use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ── VirtualScrollEngine ─────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct VirtualScrollEngine {
    item_count: usize,
    viewport_height: f64,
    overscan_count: usize,
    scroll_offset: f64,
    default_item_height: f64,
    item_heights: HashMap<usize, f64>,
    anchor: Option<usize>,
    anchor_original_top: f64,
    cached_visible_start: usize,
    cached_visible_end: usize,
    cached_total_height: f64,
    range_dirty: bool,
    height_dirty: bool,
    data_version: u32,
}

#[wasm_bindgen]
impl VirtualScrollEngine {
    // ── Constructor ────────────────────────────────────────────────────

    #[wasm_bindgen(constructor)]
    pub fn new() -> VirtualScrollEngine {
        VirtualScrollEngine {
            item_count: 0,
            viewport_height: 0.0,
            overscan_count: 0,
            scroll_offset: 0.0,
            default_item_height: 40.0,
            item_heights: HashMap::new(),
            anchor: None,
            anchor_original_top: 0.0,
            cached_visible_start: 0,
            cached_visible_end: 0,
            cached_total_height: 0.0,
            range_dirty: false,
            height_dirty: false,
            data_version: 0,
        }
    }

    // ── Version tracking ───────────────────────────────────────────────

    pub fn data_version(&self) -> u32 {
        self.data_version
    }

    fn bump_version(&mut self) {
        self.data_version = self.data_version.wrapping_add(1);
    }

    fn mark_range_dirty(&mut self) {
        self.range_dirty = true;
        self.bump_version();
    }

    fn mark_all_dirty(&mut self) {
        self.range_dirty = true;
        self.height_dirty = true;
        self.bump_version();
    }

    // ── Viewport ──────────────────────────────────────────────────────

    /// Set the viewport height in pixels.
    pub fn set_viewport_height(&mut self, height: f64) {
        self.viewport_height = height;
        self.mark_range_dirty();
    }

    /// Set the overscan count (extra items rendered above/below visible area).
    pub fn set_overscan_count(&mut self, count: usize) {
        self.overscan_count = count;
        self.mark_range_dirty();
    }

    /// Get the viewport height.
    pub fn viewport_height(&self) -> f64 {
        self.viewport_height
    }

    /// Get the overscan count.
    pub fn overscan_count(&self) -> usize {
        self.overscan_count
    }

    // ── Items ─────────────────────────────────────────────────────────

    /// Set the total number of items.
    pub fn set_item_count(&mut self, count: usize) {
        self.item_count = count;
        self.mark_all_dirty();
    }

    /// Set the height of a specific item.
    pub fn set_item_height(&mut self, index: usize, height: f64) {
        self.item_heights.insert(index, height);
        self.mark_all_dirty();
    }

    /// Set the default height for items without explicit heights.
    pub fn set_default_item_height(&mut self, height: f64) {
        self.default_item_height = height;
        self.mark_all_dirty();
    }

    /// Get the height of a specific item.
    pub fn item_height(&self, index: usize) -> f64 {
        self.item_heights
            .get(&index)
            .copied()
            .unwrap_or(self.default_item_height)
    }

    /// Get the default item height.
    pub fn default_item_height(&self) -> f64 {
        self.default_item_height
    }

    /// Get the total number of items.
    pub fn item_count(&self) -> usize {
        self.item_count
    }

    // ── Scroll ────────────────────────────────────────────────────────

    /// Set the current scroll offset in pixels.
    pub fn set_scroll_offset(&mut self, offset: f64) {
        self.scroll_offset = offset;
        self.mark_range_dirty();
    }

    /// Get the current scroll offset.
    pub fn scroll_offset(&self) -> f64 {
        self.scroll_offset
    }

    /// Get the total scrollable height.
    pub fn total_height(&mut self) -> f64 {
        self.ensure_height_computed();
        self.cached_total_height
    }

    // ── Visible range (computed) ──────────────────────────────────────

    /// Get the index of the first visible item (including overscan).
    pub fn visible_start(&mut self) -> usize {
        self.ensure_range_computed();
        self.cached_visible_start
    }

    /// Get the index past the last visible item (including overscan).
    pub fn visible_end(&mut self) -> usize {
        self.ensure_range_computed();
        self.cached_visible_end
    }

    /// Get the number of visible items (including overscan).
    pub fn visible_count(&mut self) -> usize {
        self.ensure_range_computed();
        self.cached_visible_end - self.cached_visible_start
    }

    // ── Positioning ───────────────────────────────────────────────────

    /// Get the top offset of an item in pixels.
    pub fn item_top(&self, index: usize) -> f64 {
        let mut top = 0.0;
        for i in 0..index.min(self.item_count) {
            top += self.item_heights
                .get(&i)
                .copied()
                .unwrap_or(self.default_item_height);
        }
        top
    }

    /// Get the bottom offset of an item in pixels.
    pub fn item_bottom(&self, index: usize) -> f64 {
        self.item_top(index)
            + self.item_heights
                .get(&index)
                .copied()
                .unwrap_or(self.default_item_height)
    }

    // ── Scroll-to ─────────────────────────────────────────────────────

    /// Scroll to bring an item into view (Start alignment).
    pub fn scroll_to_index(&mut self, index: usize) {
        self.scroll_offset = self.item_top(index);
        self.mark_range_dirty();
    }

    /// Scroll to bring an item into view with alignment (0=Start, 1=Center, 2=End).
    pub fn scroll_to_index_aligned(&mut self, index: usize, align: u8) {
        let top = self.item_top(index);
        let h = self.item_heights
            .get(&index)
            .copied()
            .unwrap_or(self.default_item_height);

        self.scroll_offset = match align {
            0 => top,                                          // Start
            1 => top - self.viewport_height / 2.0 + h / 2.0,  // Center
            2 => top + h - self.viewport_height,               // End
            _ => top,
        };

        if self.scroll_offset < 0.0 {
            self.scroll_offset = 0.0;
        }

        self.mark_range_dirty();
    }

    /// Whether an item is currently visible (without overscan).
    pub fn is_index_visible(&self, index: usize) -> bool {
        let top = self.item_top(index);
        let bottom = top
            + self.item_heights
                .get(&index)
                .copied()
                .unwrap_or(self.default_item_height);
        bottom > self.scroll_offset && top < self.scroll_offset + self.viewport_height
    }

    // ── Anchoring ─────────────────────────────────────────────────────

    /// Set an anchor item to maintain position during content changes.
    pub fn set_anchor(&mut self, index: usize) {
        self.anchor = Some(index);
        self.anchor_original_top = self.item_top(index);
        self.bump_version();
    }

    /// Get the current anchor item index (-1 if none).
    pub fn anchor(&self) -> i32 {
        match self.anchor {
            Some(idx) => idx as i32,
            None => -1,
        }
    }

    /// Clear the anchor.
    pub fn clear_anchor(&mut self) {
        self.anchor = None;
        self.anchor_original_top = 0.0;
        self.bump_version();
    }

    /// Get the offset delta caused by content changes relative to anchor.
    pub fn anchor_offset_delta(&self) -> f64 {
        match self.anchor {
            Some(idx) => self.item_top(idx) - self.anchor_original_top,
            None => 0.0,
        }
    }

    // ── Reset ─────────────────────────────────────────────────────────

    /// Reset all state to defaults.
    pub fn reset(&mut self) {
        self.item_count = 0;
        self.viewport_height = 0.0;
        self.overscan_count = 0;
        self.scroll_offset = 0.0;
        self.default_item_height = 40.0;
        self.item_heights.clear();
        self.anchor = None;
        self.anchor_original_top = 0.0;
        self.cached_visible_start = 0;
        self.cached_visible_end = 0;
        self.cached_total_height = 0.0;
        self.range_dirty = false;
        self.height_dirty = false;
        self.bump_version();
    }
}

// ── Private implementation ─────────────────────────────────────────────────

impl VirtualScrollEngine {
    /// Recompute total height if dirty.
    fn ensure_height_computed(&mut self) {
        if self.height_dirty {
            self.recompute_total_height();
            self.height_dirty = false;
        }
    }

    /// Recompute visible range if dirty.
    fn ensure_range_computed(&mut self) {
        self.ensure_height_computed();
        if self.range_dirty {
            self.recompute_visible_range();
            self.range_dirty = false;
        }
    }

    /// Sum all item heights to compute total scrollable height.
    fn recompute_total_height(&mut self) {
        let mut total = 0.0;
        for i in 0..self.item_count {
            total += self.item_heights
                .get(&i)
                .copied()
                .unwrap_or(self.default_item_height);
        }
        self.cached_total_height = total;
    }

    /// Binary search through cumulative heights to find visible range.
    fn recompute_visible_range(&mut self) {
        if self.item_count == 0 || self.viewport_height <= 0.0 {
            self.cached_visible_start = 0;
            self.cached_visible_end = 0;
            return;
        }

        // Find first visible item via linear scan through cumulative heights.
        // For large item counts, a binary search or prefix sum would be faster,
        // but this is correct and simple for the template.
        let mut cumulative = 0.0;
        let mut first_visible = 0;
        for i in 0..self.item_count {
            let h = self.item_heights
                .get(&i)
                .copied()
                .unwrap_or(self.default_item_height);
            if cumulative + h > self.scroll_offset {
                first_visible = i;
                break;
            }
            cumulative += h;
            // If we reach the end without finding, all items are above viewport
            if i == self.item_count - 1 {
                first_visible = self.item_count;
            }
        }

        // Find last visible item
        let viewport_end = self.scroll_offset + self.viewport_height;
        let mut last_visible = first_visible;
        let mut cum = cumulative; // cumulative height up to first_visible
        for i in first_visible..self.item_count {
            let h = self.item_heights
                .get(&i)
                .copied()
                .unwrap_or(self.default_item_height);
            cum += h;
            last_visible = i + 1;
            if cum >= viewport_end {
                break;
            }
        }

        // Apply overscan
        let start = if first_visible >= self.overscan_count {
            first_visible - self.overscan_count
        } else {
            0
        };
        let end = (last_visible + self.overscan_count).min(self.item_count);

        self.cached_visible_start = start;
        self.cached_visible_end = end;
    }
}
