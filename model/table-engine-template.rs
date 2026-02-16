// =============================================================================
// Table Engine Template (HashMap-based)
// =============================================================================
//
// This template implements the ITableEngine contract using HashMaps for flexible
// table state management. It provides:
//
//   - Server-side pagination with page/page_size/total_rows tracking
//   - Column sorting with three-state cycling (none -> asc -> desc -> none)
//   - Per-column filtering with automatic page reset
//   - Row selection with select-all/deselect-all support
//   - Inline cell editing with per-cell validation and dirty tracking
//   - Row grouping with expand/collapse state
//   - A query descriptor that the TS side reads to build server requests
//   - A needs_fetch flag so the TS side knows when to re-fetch from the server
//   - Zero-copy page data access via raw pointer + length for FlatBuffer bytes
//   - A data_version counter bumped on every state mutation, so the TS side
//     can cheaply check "did anything change?" without deep-comparing values.
//
// HOW TO USE THIS TEMPLATE:
//
//   1. Copy this file into your model crate and rename the struct.
//   2. Fill in `validate_cell()` with per-column validation logic.
//      The match arms dispatch to chainable validators from the shared crate:
//
//        "email" => validate(value).required().email().finish(),
//        "age"   => validate(value).required().positive_f64().finish(),
//
//   3. Integrate the FlatBuffer schema for your table rows. The `ingest_page()`
//      method stores raw bytes; you'll deserialize them on the TS side or add
//      a Rust accessor that reads the FlatBuffer (see commented-out example).
//   4. Expose the #[wasm_bindgen] methods to TypeScript. The TS hooks call:
//        - ingest_page(bytes, total)   after fetching a page from the server
//        - set_page(n) / set_page_size(n) for pagination controls
//        - set_sort(col, dir) / toggle_sort(col) for column header clicks
//        - set_filter(col, value) / clear_filters() for filter inputs
//        - select_row(i) / toggle_row(i) / select_all() for checkboxes
//        - set_edit_value(row, col, value) for inline editing
//        - commit_edits() to send changes to the server
//        - query_descriptor() to build the next fetch request
//        - needs_fetch() to check if a new fetch is required
//        - data_version() to trigger React re-renders
//
// HOW PAGINATION WORKS:
//
//   The server owns the full dataset. The WASM engine tracks which page the
//   user is viewing (`page`), how many rows per page (`page_size`), and the
//   total number of rows reported by the server (`total_rows`). When the user
//   changes page/page_size/sort/filter, the engine sets `needs_fetch = true`
//   and bumps `data_version`. The TS side checks `needs_fetch()`, reads
//   `query_descriptor()` to build the request, fetches from the server, and
//   calls `ingest_page(bytes, total)` with the response.
//
// HOW CELL EDITING WORKS:
//
//   Edits are stored as overlays in the `edits` HashMap keyed by (row, column).
//   When `set_edit_value` is called, the value is stored and `validate_cell`
//   runs. Errors are stored in `edit_errors`. `is_cell_dirty` checks whether
//   an edit exists for a given cell. `commit_edits()` serializes all pending
//   edits as JSON and clears the overlay. The TS side sends this JSON to the
//   server as a batch update.
//
// HOW TO INTEGRATE WITH TYPESCRIPT HOOKS:
//
//   The TypeScript useTableEngine hook should:
//     1. Hold a ref to the WASM TableEngine instance.
//     2. On mount, call new TableEngine() to create the instance.
//     3. Watch data_version() in a useSyncExternalStore or similar mechanism.
//     4. When needs_fetch() is true, read query_descriptor(), fetch from the
//        server, and call ingest_page(bytes, total_rows).
//     5. Expose pagination/sort/filter/selection/edit methods to the UI.
//     6. On save, call commit_edits() and POST the returned JSON to the server.
//
// =============================================================================

use wasm_bindgen::prelude::*;
use std::collections::{HashMap, HashSet};

// -----------------------------------------------------------------------------
// TableEngine struct
// -----------------------------------------------------------------------------
// All table state lives here. The struct is opaque to JS; only the
// #[wasm_bindgen] methods below are callable from TypeScript.
// -----------------------------------------------------------------------------

#[wasm_bindgen]
pub struct TableEngine {
    /// Raw FlatBuffer bytes from the server for the current page.
    page_data: Vec<u8>,

    /// Total number of rows in the full dataset (reported by server).
    total_rows: usize,

    /// Current page index (0-based).
    page: usize,

    /// Number of rows per page.
    page_size: usize,

    /// Column name to sort by. Empty string means no sort.
    sort_column: String,

    /// Sort direction: 0 = none, 1 = ascending, 2 = descending.
    sort_direction: u8,

    /// Per-column filter values. Key = column name, Value = filter string.
    filters: HashMap<String, String>,

    /// Set of selected row indices within the current page.
    selected: HashSet<usize>,

    /// Cell edit overlays. Key = (row_index, column_name), Value = edited value.
    edits: HashMap<(usize, String), String>,

    /// Cell edit validation errors. Key = (row_index, column_name), Value = error message.
    edit_errors: HashMap<(usize, String), String>,

    /// Column name to group by. Empty string means no grouping.
    group_by: String,

    /// Set of expanded group indices.
    expanded_groups: HashSet<usize>,

    /// Whether the TS side needs to fetch a new page from the server.
    needs_fetch: bool,

    /// Whether inline editing is enabled.
    editable: bool,

    /// Monotonically increasing counter, bumped on every state mutation.
    /// The TS side can store the last-seen version and skip re-renders
    /// when nothing changed.
    data_version: u32,
}

// =============================================================================
// WASM-exposed methods (callable from TypeScript)
// =============================================================================

#[wasm_bindgen]
impl TableEngine {
    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// Create a new TableEngine with default state.
    /// Defaults: page_size=25, editable=true, needs_fetch=true.
    #[wasm_bindgen(constructor)]
    pub fn new() -> TableEngine {
        TableEngine {
            page_data: Vec::new(),
            total_rows: 0,
            page: 0,
            page_size: 25,
            sort_column: String::new(),
            sort_direction: 0,
            filters: HashMap::new(),
            selected: HashSet::new(),
            edits: HashMap::new(),
            edit_errors: HashMap::new(),
            group_by: String::new(),
            expanded_groups: HashSet::new(),
            needs_fetch: true,
            editable: true,
            data_version: 0,
        }
    }

    // -------------------------------------------------------------------------
    // Page data access
    // -------------------------------------------------------------------------

    /// Returns a pointer to the raw page data bytes. The TS side can create
    /// a Uint8Array view over this memory to deserialize the FlatBuffer.
    pub fn page_ptr(&self) -> *const u8 {
        self.page_data.as_ptr()
    }

    /// Returns the length of the raw page data in bytes.
    pub fn page_len(&self) -> usize {
        self.page_data.len()
    }

    /// Returns the number of rows in the current page. This is the minimum
    /// of page_size and the remaining rows (total_rows - page * page_size).
    pub fn row_count(&self) -> usize {
        let offset = self.page * self.page_size;
        if offset >= self.total_rows {
            return 0;
        }
        let remaining = self.total_rows - offset;
        if remaining < self.page_size {
            remaining
        } else {
            self.page_size
        }
    }

    /// Returns the total number of rows in the full dataset.
    pub fn total_row_count(&self) -> usize {
        self.total_rows
    }

    // -------------------------------------------------------------------------
    // Ingest
    // -------------------------------------------------------------------------

    /// Store a new page of data from the server. The bytes are typically a
    /// FlatBuffer payload. Clears needs_fetch and bumps data_version.
    ///
    /// Example FlatBuffer deserialization (uncomment and adapt):
    ///
    /// ```ignore
    /// // let table = flatbuffers::root::<MyTable>(bytes).expect("valid flatbuffer");
    /// // let rows = table.rows().unwrap_or_default();
    /// // for row in rows {
    /// //     let name = row.name().unwrap_or_default();
    /// //     let value = row.value();
    /// // }
    /// ```
    pub fn ingest_page(&mut self, bytes: &[u8], total_rows: usize) {
        self.page_data = bytes.to_vec();
        self.total_rows = total_rows;
        self.needs_fetch = false;
        self.data_version += 1;
    }

    // -------------------------------------------------------------------------
    // Pagination
    // -------------------------------------------------------------------------

    /// Returns the current page index (0-based).
    pub fn page(&self) -> usize {
        self.page
    }

    /// Returns the number of rows per page.
    pub fn page_size(&self) -> usize {
        self.page_size
    }

    /// Returns the total number of pages, computed from total_rows and page_size.
    pub fn page_count(&self) -> usize {
        if self.page_size == 0 {
            return 0;
        }
        (self.total_rows + self.page_size - 1) / self.page_size
    }

    /// Navigate to a specific page. Sets needs_fetch so the TS side will
    /// re-fetch data from the server.
    pub fn set_page(&mut self, page: usize) {
        self.page = page;
        self.needs_fetch = true;
        self.data_version += 1;
    }

    /// Change the number of rows per page. Resets to page 0 and sets
    /// needs_fetch so the TS side will re-fetch.
    pub fn set_page_size(&mut self, size: usize) {
        self.page_size = size;
        self.page = 0;
        self.needs_fetch = true;
        self.data_version += 1;
    }

    // -------------------------------------------------------------------------
    // Sort
    // -------------------------------------------------------------------------

    /// Returns the current sort column name, or "" if no sort is active.
    pub fn sort_column(&self) -> String {
        self.sort_column.clone()
    }

    /// Returns the current sort direction: 0 = none, 1 = asc, 2 = desc.
    pub fn sort_direction(&self) -> u8 {
        self.sort_direction
    }

    /// Set the sort column and direction explicitly. Sets needs_fetch so
    /// the TS side will re-fetch sorted data from the server.
    pub fn set_sort(&mut self, column: &str, direction: u8) {
        self.sort_column = column.to_string();
        self.sort_direction = direction;
        self.needs_fetch = true;
        self.data_version += 1;
    }

    /// Cycle sort direction for a column: none -> asc -> desc -> none.
    /// If clicking a different column, starts at asc. Sets needs_fetch
    /// so the TS side will re-fetch sorted data from the server.
    pub fn toggle_sort(&mut self, column: &str) {
        if self.sort_column == column {
            // Same column: cycle through directions.
            match self.sort_direction {
                0 => {
                    self.sort_direction = 1;
                }
                1 => {
                    self.sort_direction = 2;
                }
                _ => {
                    // desc -> none: clear the sort column.
                    self.sort_column = String::new();
                    self.sort_direction = 0;
                }
            }
        } else {
            // Different column: start with ascending.
            self.sort_column = column.to_string();
            self.sort_direction = 1;
        }
        self.needs_fetch = true;
        self.data_version += 1;
    }

    // -------------------------------------------------------------------------
    // Filter
    // -------------------------------------------------------------------------

    /// Returns the current filter value for a column, or "" if no filter is set.
    pub fn filter_value(&self, column: &str) -> String {
        self.filters.get(column).cloned().unwrap_or_default()
    }

    /// Set a filter value for a column. If the value is empty, the filter is
    /// removed. Resets to page 0 and sets needs_fetch.
    pub fn set_filter(&mut self, column: &str, value: &str) {
        if value.is_empty() {
            self.filters.remove(column);
        } else {
            self.filters.insert(column.to_string(), value.to_string());
        }
        self.page = 0;
        self.needs_fetch = true;
        self.data_version += 1;
    }

    /// Remove all filters. Resets to page 0 and sets needs_fetch.
    pub fn clear_filters(&mut self) {
        self.filters.clear();
        self.page = 0;
        self.needs_fetch = true;
        self.data_version += 1;
    }

    // -------------------------------------------------------------------------
    // Selection
    // -------------------------------------------------------------------------

    /// Returns true if the given row index is currently selected.
    pub fn is_row_selected(&self, row_index: usize) -> bool {
        self.selected.contains(&row_index)
    }

    /// Add a row to the selection set.
    pub fn select_row(&mut self, row_index: usize) {
        self.selected.insert(row_index);
        self.data_version += 1;
    }

    /// Remove a row from the selection set.
    pub fn deselect_row(&mut self, row_index: usize) {
        self.selected.remove(&row_index);
        self.data_version += 1;
    }

    /// Toggle a row's selection state.
    pub fn toggle_row(&mut self, row_index: usize) {
        if self.selected.contains(&row_index) {
            self.selected.remove(&row_index);
        } else {
            self.selected.insert(row_index);
        }
        self.data_version += 1;
    }

    /// Select all rows in the current page (0..row_count).
    pub fn select_all(&mut self) {
        let count = self.row_count();
        for i in 0..count {
            self.selected.insert(i);
        }
        self.data_version += 1;
    }

    /// Clear all selections.
    pub fn deselect_all(&mut self) {
        self.selected.clear();
        self.data_version += 1;
    }

    /// Returns the number of currently selected rows.
    pub fn selected_count(&self) -> usize {
        self.selected.len()
    }

    /// Returns true if all rows in the current page are selected.
    pub fn all_selected(&self) -> bool {
        let count = self.row_count();
        if count == 0 {
            return false;
        }
        for i in 0..count {
            if !self.selected.contains(&i) {
                return false;
            }
        }
        true
    }

    // -------------------------------------------------------------------------
    // Cell editing
    // -------------------------------------------------------------------------

    /// Returns true if inline editing is enabled.
    pub fn is_editable(&self) -> bool {
        self.editable
    }

    /// Returns the edit overlay value for a cell, or "" if no edit exists.
    pub fn edit_value(&self, row_index: usize, column: &str) -> String {
        let key = (row_index, column.to_string());
        self.edits.get(&key).cloned().unwrap_or_default()
    }

    /// Set an edit value for a cell. Runs validation and stores any error.
    /// Bumps data_version.
    pub fn set_edit_value(&mut self, row_index: usize, column: &str, value: &str) {
        let key = (row_index, column.to_string());
        self.edits.insert(key.clone(), value.to_string());

        // Validate the cell and store or clear the error.
        match self.validate_cell(row_index, column, value) {
            Ok(()) => {
                self.edit_errors.remove(&key);
            }
            Err(msg) => {
                self.edit_errors.insert(key, msg);
            }
        }

        self.data_version += 1;
    }

    /// Returns the validation error for a cell, or "" if no error exists.
    pub fn cell_error(&self, row_index: usize, column: &str) -> String {
        let key = (row_index, column.to_string());
        self.edit_errors.get(&key).cloned().unwrap_or_default()
    }

    /// Returns true if a cell has a pending edit overlay.
    pub fn is_cell_dirty(&self, row_index: usize, column: &str) -> bool {
        let key = (row_index, column.to_string());
        self.edits.contains_key(&key)
    }

    /// Returns true if there are any pending edit overlays.
    pub fn has_edits(&self) -> bool {
        !self.edits.is_empty()
    }

    /// Serialize all pending edits as JSON, clear the edit overlays and errors,
    /// and bump data_version. The TS side should POST this JSON to the server.
    ///
    /// Returns JSON in the format:
    /// `{"edits":[{"row":0,"column":"name","value":"new"},...]}`
    pub fn commit_edits(&mut self) -> String {
        let mut entries = Vec::new();
        for ((row, column), value) in &self.edits {
            // Escape JSON string values by replacing \ and " characters.
            let escaped_col = column.replace('\\', "\\\\").replace('"', "\\\"");
            let escaped_val = value.replace('\\', "\\\\").replace('"', "\\\"");
            entries.push(format!(
                "{{\"row\":{},\"column\":\"{}\",\"value\":\"{}\"}}",
                row, escaped_col, escaped_val
            ));
        }

        let json = format!("{{\"edits\":[{}]}}", entries.join(","));

        self.edits.clear();
        self.edit_errors.clear();
        self.data_version += 1;

        json
    }

    /// Discard all pending edits and clear validation errors. Bumps data_version.
    pub fn discard_edits(&mut self) {
        self.edits.clear();
        self.edit_errors.clear();
        self.data_version += 1;
    }

    // -------------------------------------------------------------------------
    // Grouping
    // -------------------------------------------------------------------------

    /// Returns the column name used for grouping, or "" if no grouping is active.
    pub fn group_by_column(&self) -> String {
        self.group_by.clone()
    }

    /// Set the column to group by. Sets needs_fetch so the TS side will
    /// re-fetch grouped data from the server.
    pub fn set_group_by(&mut self, column: &str) {
        self.group_by = column.to_string();
        self.expanded_groups.clear();
        self.needs_fetch = true;
        self.data_version += 1;
    }

    /// Clear grouping. Sets needs_fetch so the TS side will re-fetch.
    pub fn clear_group_by(&mut self) {
        self.group_by = String::new();
        self.expanded_groups.clear();
        self.needs_fetch = true;
        self.data_version += 1;
    }

    /// Returns the number of groups. Returns 0 if no grouping is active.
    ///
    /// NOTE: In a real implementation, this would be derived from the ingested
    /// page data (e.g., parsed from FlatBuffer group metadata). This placeholder
    /// returns 0 -- replace it with your actual group extraction logic.
    pub fn group_count(&self) -> usize {
        if self.group_by.is_empty() {
            return 0;
        }
        // TODO: Extract group count from page_data (FlatBuffer).
        // Example: parse group metadata from the server response.
        0
    }

    /// Returns the display label for a group at the given index.
    ///
    /// NOTE: Placeholder -- replace with actual FlatBuffer group label extraction.
    pub fn group_label(&self, _group_index: usize) -> String {
        // TODO: Extract group label from page_data (FlatBuffer).
        String::new()
    }

    /// Returns JSON describing the rows in a group at the given index.
    ///
    /// NOTE: Placeholder -- replace with actual FlatBuffer group row extraction.
    /// Expected format: `{"rows":[0,1,2,...]}` or similar.
    pub fn group_row_count(&self, _group_index: usize) -> String {
        // TODO: Extract group row data from page_data (FlatBuffer).
        "{\"rows\":[]}".to_string()
    }

    /// Returns true if the group at the given index is expanded.
    pub fn is_group_expanded(&self, group_index: usize) -> bool {
        self.expanded_groups.contains(&group_index)
    }

    /// Toggle the expanded/collapsed state of a group. Bumps data_version.
    pub fn toggle_group(&mut self, group_index: usize) {
        if self.expanded_groups.contains(&group_index) {
            self.expanded_groups.remove(&group_index);
        } else {
            self.expanded_groups.insert(group_index);
        }
        self.data_version += 1;
    }

    // -------------------------------------------------------------------------
    // Query descriptor
    // -------------------------------------------------------------------------

    /// Returns true if the TS side needs to fetch a new page from the server.
    pub fn needs_fetch(&self) -> bool {
        self.needs_fetch
    }

    /// Acknowledge that a fetch has been initiated. Clears the needs_fetch flag.
    /// Call this after reading query_descriptor() and starting the fetch.
    pub fn acknowledge_fetch(&mut self) {
        self.needs_fetch = false;
    }

    /// Returns a JSON descriptor of the current query state. The TS side uses
    /// this to build the server request (API call, GraphQL query, etc.).
    ///
    /// Format:
    /// ```json
    /// {
    ///   "page": 0,
    ///   "page_size": 25,
    ///   "sort_column": "name",
    ///   "sort_direction": 1,
    ///   "filters": {"status":"active","role":"admin"},
    ///   "group_by": ""
    /// }
    /// ```
    pub fn query_descriptor(&self) -> String {
        // Build filters object manually.
        let mut filter_entries = Vec::new();
        for (key, value) in &self.filters {
            let escaped_key = key.replace('\\', "\\\\").replace('"', "\\\"");
            let escaped_val = value.replace('\\', "\\\\").replace('"', "\\\"");
            filter_entries.push(format!("\"{}\":\"{}\"", escaped_key, escaped_val));
        }

        let escaped_sort = self.sort_column.replace('\\', "\\\\").replace('"', "\\\"");
        let escaped_group = self.group_by.replace('\\', "\\\\").replace('"', "\\\"");

        format!(
            "{{\"page\":{},\"page_size\":{},\"sort_column\":\"{}\",\"sort_direction\":{},\"filters\":{{{}}},\"group_by\":\"{}\"}}",
            self.page,
            self.page_size,
            escaped_sort,
            self.sort_direction,
            filter_entries.join(","),
            escaped_group
        )
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// Returns the current data version. The TS side can compare this to a
    /// previously stored version to decide whether a re-render is needed.
    pub fn data_version(&self) -> u32 {
        self.data_version
    }

    /// Reset all state to defaults. Clears page data, selections, edits,
    /// filters, sort, grouping. Sets needs_fetch and bumps data_version.
    pub fn reset(&mut self) {
        self.page_data.clear();
        self.total_rows = 0;
        self.page = 0;
        self.page_size = 25;
        self.sort_column = String::new();
        self.sort_direction = 0;
        self.filters.clear();
        self.selected.clear();
        self.edits.clear();
        self.edit_errors.clear();
        self.group_by = String::new();
        self.expanded_groups.clear();
        self.needs_fetch = true;
        self.editable = true;
        self.data_version += 1;
    }
}

// =============================================================================
// Internal methods (NOT exposed to WASM / TypeScript)
// =============================================================================

impl TableEngine {
    // -------------------------------------------------------------------------
    // Cell validation
    // -------------------------------------------------------------------------

    /// Dispatch validation for a single cell based on its column name.
    ///
    /// CUSTOMIZE THIS: Add a match arm for each column that needs validation.
    /// Use the chainable validators from the shared crate:
    ///
    ///   use shared::validation::{validate};
    ///
    ///   "email"  => validate(value).required().email().finish(),
    ///   "age"    => validate(value).required().positive_f64().range_f64(1.0, 150.0).finish(),
    ///   "name"   => validate(value).required().min_length(2).max_length(100).finish(),
    ///   "status" => validate(value).one_of(&["active", "inactive", "pending"]).finish(),
    ///
    /// If a column has no validation, return Ok(()).
    fn validate_cell(&self, _row_index: usize, column: &str, value: &str) -> Result<(), String> {
        match column {
            // ------------------------------------------------------------------
            // Example validation rules -- replace with your actual rules:
            // ------------------------------------------------------------------
            "name" => {
                if value.is_empty() {
                    return Err("Name is required".to_string());
                }
                if value.len() < 2 {
                    return Err("Name must be at least 2 characters".to_string());
                }
                Ok(())
            }

            "email" => {
                if value.is_empty() {
                    return Err("Email is required".to_string());
                }
                // Basic email check -- use validate(value).email() from shared crate
                // for the real implementation.
                if !value.contains('@') || !value.split('@').nth(1).map_or(false, |d| d.contains('.')) {
                    return Err("Please enter a valid email address".to_string());
                }
                Ok(())
            }

            "age" => {
                if value.is_empty() {
                    return Err("Age is required".to_string());
                }
                match value.parse::<f64>() {
                    Ok(n) if n > 0.0 && n <= 150.0 => Ok(()),
                    Ok(_) => Err("Age must be between 1 and 150".to_string()),
                    Err(_) => Err("Age must be a number".to_string()),
                }
            }

            // Columns with no validation pass automatically.
            _ => Ok(()),
        }
    }
}

// =============================================================================
// VIRTUAL SCROLLING / INFINITE SCROLL EXTENSION (commented out)
// =============================================================================
//
// If your table uses virtual scrolling instead of traditional pagination,
// uncomment and extend the following. The pattern is:
//
//   - `visible_start: usize` tracks the first visible row index.
//   - `visible_end: usize` tracks the last visible row index (exclusive).
//   - `row_height: f64` is the fixed row height in pixels.
//   - `overscan: usize` is the number of extra rows to render above/below.
//   - `set_viewport(scroll_top, container_height)` computes visible range.
//   - `visible_range_start() / visible_range_end()` return the range to render.
//
// #[wasm_bindgen]
// impl TableEngine {
//     /// Set the viewport scroll position. Computes the visible row range
//     /// based on scroll offset and container height.
//     pub fn set_viewport(&mut self, scroll_top: f64, container_height: f64) {
//         let row_h = self.row_height;
//         if row_h <= 0.0 {
//             return;
//         }
//
//         let first = (scroll_top / row_h) as usize;
//         let visible_count = (container_height / row_h).ceil() as usize;
//
//         let start = if first > self.overscan { first - self.overscan } else { 0 };
//         let end = (first + visible_count + self.overscan).min(self.total_rows);
//
//         if start != self.visible_start || end != self.visible_end {
//             self.visible_start = start;
//             self.visible_end = end;
//             self.data_version += 1;
//         }
//     }
//
//     /// Returns the first row index that should be rendered.
//     pub fn visible_range_start(&self) -> usize {
//         self.visible_start
//     }
//
//     /// Returns one past the last row index that should be rendered.
//     pub fn visible_range_end(&self) -> usize {
//         self.visible_end
//     }
//
//     /// Returns the total scrollable height in pixels (total_rows * row_height).
//     pub fn total_height(&self) -> f64 {
//         self.total_rows as f64 * self.row_height
//     }
//
//     /// Returns the offset in pixels for the first visible row.
//     pub fn offset_y(&self) -> f64 {
//         self.visible_start as f64 * self.row_height
//     }
// }
