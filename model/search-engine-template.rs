// ============================================================================
// SEARCH ENGINE TEMPLATE — Rust/WASM Client-Side Search/Filter State Machine
// ============================================================================
//
// HOW TO USE THIS TEMPLATE:
//
// 1. COPY this file and rename it (e.g., search-engine.rs).
//
// 2. THE PATTERN:
//    - JS calls load_items(json) with a JSON array of objects
//    - JS calls set_query("text"), add_filter("field", op, "value"), etc.
//    - Engine lazily recomputes results when state is read (dirty flag)
//    - JS reads results via result_id(index), result_value(index, field)
//    - Facets computed on-the-fly over filtered results
//
// 3. LAZY RECOMPUTATION:
//    Mutations (set_query, add_filter, set_sort, etc.) set dirty=true.
//    Reads (result_count, result_id, etc.) call recompute() if dirty.
//    This avoids redundant computation when multiple mutations happen
//    before a read (e.g., set_query + add_filter + set_sort).
//
// 4. FILTER OPERATORS:
//    0=Eq, 1=NotEq, 2=Gt, 3=Lt, 4=Gte, 5=Lte, 6=Contains, 7=StartsWith, 8=In
//    Numeric comparisons parse values as f64 with string fallback.
//
// 5. FACETS:
//    facet_count(field) returns the number of distinct values for that field
//    across the current filtered results. Computed on-the-fly.
//
// 6. PAGINATION:
//    Default page_size = 25. Results are paginated: result_id(0) through
//    result_id(page_size-1) return items within the current page.
//
// ============================================================================

use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ── Filter types ───────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct FilterEntry {
    field: String,
    op: u8,
    value: String,
}

// ── SearchEngine ───────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct SearchEngine {
    items: Vec<HashMap<String, String>>,
    query: String,
    search_fields: Vec<String>,
    filters: Vec<FilterEntry>,
    sort_field: String,
    sort_direction: u8, // 0=none, 1=asc, 2=desc
    page: usize,
    page_size: usize,
    /// Indices into `items` that match the current query + filters, sorted.
    result_indices: Vec<usize>,
    dirty: bool,
    data_version: u32,
}

#[wasm_bindgen]
impl SearchEngine {
    // ── Constructor ────────────────────────────────────────────────────

    #[wasm_bindgen(constructor)]
    pub fn new() -> SearchEngine {
        SearchEngine {
            items: Vec::new(),
            query: String::new(),
            search_fields: Vec::new(),
            filters: Vec::new(),
            sort_field: String::new(),
            sort_direction: 0,
            page: 0,
            page_size: 25,
            result_indices: Vec::new(),
            dirty: false,
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

    fn mark_dirty(&mut self) {
        self.dirty = true;
        self.bump_version();
    }

    // ── Data ───────────────────────────────────────────────────────────

    /// Load items from a JSON array of objects.
    /// Each object becomes a HashMap<String, String>.
    pub fn load_items(&mut self, json: &str) {
        self.items = parse_json_array(json);
        self.page = 0;
        self.mark_dirty();
    }

    /// Clear all items.
    pub fn clear_items(&mut self) {
        self.items.clear();
        self.result_indices.clear();
        self.page = 0;
        self.dirty = false;
        self.bump_version();
    }

    /// Total number of loaded items.
    pub fn item_count(&self) -> usize {
        self.items.len()
    }

    /// Number of items matching current query/filters.
    pub fn result_count(&mut self) -> usize {
        self.ensure_computed();
        self.result_indices.len()
    }

    // ── Search ─────────────────────────────────────────────────────────

    /// Set the search query text.
    pub fn set_query(&mut self, text: &str) {
        self.query = text.to_string();
        self.page = 0;
        self.mark_dirty();
    }

    /// Get the current search query.
    pub fn current_query(&self) -> String {
        self.query.clone()
    }

    /// Set which fields to search. JSON array of field names.
    pub fn set_search_fields(&mut self, json: &str) {
        self.search_fields = parse_json_string_array(json);
        self.mark_dirty();
    }

    // ── Filters ────────────────────────────────────────────────────────

    /// Add a filter. op: 0=Eq,1=NotEq,2=Gt,3=Lt,4=Gte,5=Lte,6=Contains,7=StartsWith,8=In
    pub fn add_filter(&mut self, field: &str, op: u8, value: &str) {
        self.filters.push(FilterEntry {
            field: field.to_string(),
            op,
            value: value.to_string(),
        });
        self.page = 0;
        self.mark_dirty();
    }

    /// Remove a filter by index.
    pub fn remove_filter(&mut self, index: usize) {
        if index < self.filters.len() {
            self.filters.remove(index);
            self.page = 0;
            self.mark_dirty();
        }
    }

    /// Clear all filters.
    pub fn clear_filters(&mut self) {
        self.filters.clear();
        self.page = 0;
        self.mark_dirty();
    }

    /// Number of active filters.
    pub fn filter_count(&self) -> usize {
        self.filters.len()
    }

    /// Get the field name of a filter by index.
    pub fn filter_field(&self, index: usize) -> String {
        self.filters
            .get(index)
            .map(|f| f.field.clone())
            .unwrap_or_default()
    }

    /// Get the operator of a filter by index.
    pub fn filter_op(&self, index: usize) -> u8 {
        self.filters.get(index).map(|f| f.op).unwrap_or(0)
    }

    /// Get the value of a filter by index.
    pub fn filter_value(&self, index: usize) -> String {
        self.filters
            .get(index)
            .map(|f| f.value.clone())
            .unwrap_or_default()
    }

    // ── Sort ───────────────────────────────────────────────────────────

    /// Set sort field and direction (0=none, 1=asc, 2=desc).
    pub fn set_sort(&mut self, field: &str, direction: u8) {
        self.sort_field = field.to_string();
        self.sort_direction = direction;
        self.mark_dirty();
    }

    /// Clear sort.
    pub fn clear_sort(&mut self) {
        self.sort_field.clear();
        self.sort_direction = 0;
        self.mark_dirty();
    }

    /// Current sort field.
    pub fn sort_field(&self) -> String {
        self.sort_field.clone()
    }

    /// Current sort direction.
    pub fn sort_direction(&self) -> u8 {
        self.sort_direction
    }

    // ── Results (paginated) ────────────────────────────────────────────

    /// Get the ID of a result at index (within current page).
    /// Falls back to "id" field, then to the global item index as string.
    pub fn result_id(&mut self, index: usize) -> String {
        self.ensure_computed();
        let global_idx = self.page * self.page_size + index;
        if global_idx >= self.result_indices.len() {
            return String::new();
        }
        let item_idx = self.result_indices[global_idx];
        if let Some(item) = self.items.get(item_idx) {
            item.get("id")
                .cloned()
                .unwrap_or_else(|| item_idx.to_string())
        } else {
            String::new()
        }
    }

    /// Get a field value of a result at index (within current page).
    pub fn result_value(&mut self, index: usize, field: &str) -> String {
        self.ensure_computed();
        let global_idx = self.page * self.page_size + index;
        if global_idx >= self.result_indices.len() {
            return String::new();
        }
        let item_idx = self.result_indices[global_idx];
        self.items
            .get(item_idx)
            .and_then(|item| item.get(field))
            .cloned()
            .unwrap_or_default()
    }

    // ── Pagination ─────────────────────────────────────────────────────

    /// Set the current page (0-based).
    pub fn set_page(&mut self, page: usize) {
        self.page = page;
        self.bump_version();
    }

    /// Set the page size.
    pub fn set_page_size(&mut self, size: usize) {
        self.page_size = if size == 0 { 25 } else { size };
        self.page = 0;
        self.bump_version();
    }

    /// Current page index.
    pub fn page(&self) -> usize {
        self.page
    }

    /// Current page size.
    pub fn page_size(&self) -> usize {
        self.page_size
    }

    /// Total number of pages.
    pub fn page_count(&mut self) -> usize {
        self.ensure_computed();
        let total = self.result_indices.len();
        if total == 0 {
            0
        } else {
            (total + self.page_size - 1) / self.page_size
        }
    }

    // ── Facets ─────────────────────────────────────────────────────────

    /// Number of distinct values for a field across current results.
    pub fn facet_count(&mut self, field: &str) -> usize {
        self.ensure_computed();
        let mut seen = Vec::new();
        for &idx in &self.result_indices {
            if let Some(item) = self.items.get(idx) {
                if let Some(val) = item.get(field) {
                    if !seen.contains(val) {
                        seen.push(val.clone());
                    }
                }
            }
        }
        seen.len()
    }

    /// Get a facet value by field and index.
    pub fn facet_value(&mut self, field: &str, index: usize) -> String {
        self.ensure_computed();
        let mut seen = Vec::new();
        for &idx in &self.result_indices {
            if let Some(item) = self.items.get(idx) {
                if let Some(val) = item.get(field) {
                    if !seen.contains(val) {
                        seen.push(val.clone());
                    }
                }
            }
        }
        seen.get(index).cloned().unwrap_or_default()
    }

    /// Number of items matching a specific facet value.
    pub fn facet_item_count(&mut self, field: &str, value: &str) -> usize {
        self.ensure_computed();
        let mut count = 0;
        for &idx in &self.result_indices {
            if let Some(item) = self.items.get(idx) {
                if item.get(field).map(|v| v.as_str()) == Some(value) {
                    count += 1;
                }
            }
        }
        count
    }

    // ── Reset ──────────────────────────────────────────────────────────

    /// Reset all state to defaults.
    pub fn reset(&mut self) {
        self.items.clear();
        self.query.clear();
        self.search_fields.clear();
        self.filters.clear();
        self.sort_field.clear();
        self.sort_direction = 0;
        self.page = 0;
        self.page_size = 25;
        self.result_indices.clear();
        self.dirty = false;
        self.bump_version();
    }
}

// ── Private implementation ─────────────────────────────────────────────────

impl SearchEngine {
    /// Recompute results if dirty.
    fn ensure_computed(&mut self) {
        if self.dirty {
            self.recompute();
            self.dirty = false;
        }
    }

    /// Full recomputation: filter → sort → store result indices.
    fn recompute(&mut self) {
        let query_lower = self.query.to_lowercase();

        // Filter phase: collect matching item indices
        let mut indices: Vec<usize> = (0..self.items.len())
            .filter(|&i| {
                let item = &self.items[i];

                // Text search: if query is non-empty, at least one search field
                // must contain the query (case-insensitive)
                if !query_lower.is_empty() {
                    let matches_query = if self.search_fields.is_empty() {
                        // Search all fields
                        item.values()
                            .any(|v| v.to_lowercase().contains(&query_lower))
                    } else {
                        self.search_fields.iter().any(|field| {
                            item.get(field)
                                .map(|v| v.to_lowercase().contains(&query_lower))
                                .unwrap_or(false)
                        })
                    };
                    if !matches_query {
                        return false;
                    }
                }

                // Filter evaluation
                for filter in &self.filters {
                    let field_val = item.get(&filter.field).map(|v| v.as_str()).unwrap_or("");
                    if !evaluate_filter(field_val, filter.op, &filter.value) {
                        return false;
                    }
                }

                true
            })
            .collect();

        // Sort phase
        if self.sort_direction != 0 && !self.sort_field.is_empty() {
            let field = self.sort_field.clone();
            let asc = self.sort_direction == 1;

            indices.sort_by(|&a, &b| {
                let va = self.items[a].get(&field).map(|v| v.as_str()).unwrap_or("");
                let vb = self.items[b].get(&field).map(|v| v.as_str()).unwrap_or("");

                // Try numeric comparison first
                let cmp = match (va.parse::<f64>(), vb.parse::<f64>()) {
                    (Ok(na), Ok(nb)) => na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal),
                    _ => va.cmp(vb),
                };

                if asc { cmp } else { cmp.reverse() }
            });
        }

        self.result_indices = indices;
    }
}

/// Evaluate a single filter condition.
fn evaluate_filter(field_val: &str, op: u8, filter_val: &str) -> bool {
    match op {
        0 => field_val == filter_val, // Eq
        1 => field_val != filter_val, // NotEq
        2 => { // Gt
            match (field_val.parse::<f64>(), filter_val.parse::<f64>()) {
                (Ok(a), Ok(b)) => a > b,
                _ => field_val > filter_val,
            }
        }
        3 => { // Lt
            match (field_val.parse::<f64>(), filter_val.parse::<f64>()) {
                (Ok(a), Ok(b)) => a < b,
                _ => field_val < filter_val,
            }
        }
        4 => { // Gte
            match (field_val.parse::<f64>(), filter_val.parse::<f64>()) {
                (Ok(a), Ok(b)) => a >= b,
                _ => field_val >= filter_val,
            }
        }
        5 => { // Lte
            match (field_val.parse::<f64>(), filter_val.parse::<f64>()) {
                (Ok(a), Ok(b)) => a <= b,
                _ => field_val <= filter_val,
            }
        }
        6 => { // Contains
            field_val.to_lowercase().contains(&filter_val.to_lowercase())
        }
        7 => { // StartsWith
            field_val.to_lowercase().starts_with(&filter_val.to_lowercase())
        }
        8 => { // In (comma-separated values)
            filter_val.split(',').any(|v| v.trim() == field_val)
        }
        _ => true,
    }
}

// ── Helpers — lightweight JSON parsing without serde ────────────────────────

/// Parse a JSON array of objects into Vec<HashMap<String, String>>.
fn parse_json_array(json: &str) -> Vec<HashMap<String, String>> {
    let mut items = Vec::new();
    let json = json.trim();
    if json.len() < 2 || !json.starts_with('[') || !json.ends_with(']') {
        return items;
    }

    let inner = &json[1..json.len() - 1];
    let mut depth = 0;
    let mut start = 0;

    for (i, c) in inner.char_indices() {
        match c {
            '{' => {
                if depth == 0 {
                    start = i;
                }
                depth += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let obj_str = &inner[start..=i];
                    items.push(parse_flat_object(obj_str));
                }
            }
            _ => {}
        }
    }

    items
}

/// Parse a flat JSON object {"key":"value",...} into a HashMap.
fn parse_flat_object(json: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let json = json.trim();
    if json.len() < 2 || !json.starts_with('{') || !json.ends_with('}') {
        return map;
    }

    let inner = &json[1..json.len() - 1];
    let mut chars = inner.chars().peekable();

    loop {
        skip_whitespace_and_commas(&mut chars);
        if chars.peek().is_none() {
            break;
        }
        if let Some(key) = parse_json_str(&mut chars) {
            skip_colon_and_whitespace(&mut chars);
            if let Some(value) = parse_json_str(&mut chars) {
                map.insert(key, value);
            } else {
                // Try parsing non-string value (number, bool)
                let value = parse_non_string_value(&mut chars);
                map.insert(key, value);
            }
        } else {
            break;
        }
    }

    map
}

/// Parse a JSON string array ["a","b","c"] into Vec<String>.
fn parse_json_string_array(json: &str) -> Vec<String> {
    let mut result = Vec::new();
    let json = json.trim();
    if json.len() < 2 || !json.starts_with('[') || !json.ends_with(']') {
        return result;
    }

    let inner = &json[1..json.len() - 1];
    let mut chars = inner.chars().peekable();

    loop {
        skip_whitespace_and_commas(&mut chars);
        if chars.peek().is_none() {
            break;
        }
        if let Some(s) = parse_json_str(&mut chars) {
            result.push(s);
        } else {
            break;
        }
    }

    result
}

fn parse_json_str(chars: &mut std::iter::Peekable<std::str::Chars>) -> Option<String> {
    if chars.peek() != Some(&'"') {
        return None;
    }
    chars.next();
    let mut result = String::new();
    loop {
        match chars.next() {
            Some('\\') => {
                if let Some(c) = chars.next() {
                    match c {
                        'n' => result.push('\n'),
                        'r' => result.push('\r'),
                        't' => result.push('\t'),
                        _ => result.push(c),
                    }
                }
            }
            Some('"') => return Some(result),
            Some(c) => result.push(c),
            None => return Some(result),
        }
    }
}

fn parse_non_string_value(chars: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut result = String::new();
    while let Some(&c) = chars.peek() {
        if c == ',' || c == '}' || c == ']' {
            break;
        }
        result.push(c);
        chars.next();
    }
    result.trim().to_string()
}

fn skip_whitespace_and_commas(chars: &mut std::iter::Peekable<std::str::Chars>) {
    while chars.peek().map_or(false, |c| *c == ' ' || *c == ',' || *c == '\n' || *c == '\r' || *c == '\t') {
        chars.next();
    }
}

fn skip_colon_and_whitespace(chars: &mut std::iter::Peekable<std::str::Chars>) {
    while chars.peek().map_or(false, |c| *c == ':' || *c == ' ') {
        chars.next();
    }
}
