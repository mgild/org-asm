// ============================================================================
// SELECTION ENGINE TEMPLATE — Rust/WASM Client-Side Selection State Machine
// ============================================================================
//
// HOW TO USE THIS TEMPLATE:
//
// 1. COPY this file and rename it (e.g., selection-engine.rs).
//
// 2. THE PATTERN:
//    - JS calls set_items(json) with a JSON array of ID strings
//    - JS calls select(id), deselect(id), toggle(id), etc.
//    - Engine maintains selected set, focus, anchor, and mode
//    - JS reads state via is_selected(id), focus(), selected_count(), etc.
//
// 3. SELECTION MODES:
//    0 = Single: selecting a new item deselects the previous one
//    1 = Multi: toggle individual items independently
//    2 = Range: shift-click selects all items between anchor and target
//
// 4. KEYBOARD NAVIGATION:
//    move_focus(direction) moves focus by direction (0=up, 1=down, 2=left, 3=right)
//    activate_focus() selects the currently focused item
//
// 5. SELECTED ORDER:
//    selected_id(index) returns items in selection order via selected_order Vec.
//    This preserves the order in which items were selected.
//
// ============================================================================

use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

// ── SelectionEngine ─────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct SelectionEngine {
    mode: u8, // 0=single, 1=multi, 2=range
    items: Vec<String>,
    item_indices: HashMap<String, usize>,
    selected: HashSet<String>,
    selected_order: Vec<String>, // for indexed access via selected_id()
    focus: Option<String>,
    anchor: Option<String>,
    data_version: u32,
}

#[wasm_bindgen]
impl SelectionEngine {
    // ── Constructor ────────────────────────────────────────────────────

    #[wasm_bindgen(constructor)]
    pub fn new() -> SelectionEngine {
        SelectionEngine {
            mode: 0,
            items: Vec::new(),
            item_indices: HashMap::new(),
            selected: HashSet::new(),
            selected_order: Vec::new(),
            focus: None,
            anchor: None,
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

    // ── Mode ──────────────────────────────────────────────────────────

    /// Set the selection mode (0=single,1=multi,2=range).
    pub fn set_mode(&mut self, mode: u8) {
        self.mode = mode;
        self.bump_version();
    }

    /// Get the current selection mode.
    pub fn mode(&self) -> u8 {
        self.mode
    }

    // ── Items ─────────────────────────────────────────────────────────

    /// Set items from a JSON array of ID strings.
    pub fn set_items(&mut self, json: &str) {
        self.items = parse_json_string_array(json);
        self.rebuild_indices();
        self.bump_version();
    }

    /// Add an item at a specific index.
    pub fn add_item(&mut self, id: &str, index: usize) {
        let idx = if index > self.items.len() {
            self.items.len()
        } else {
            index
        };
        self.items.insert(idx, id.to_string());
        self.rebuild_indices();
        self.bump_version();
    }

    /// Remove an item by ID.
    pub fn remove_item(&mut self, id: &str) {
        if let Some(idx) = self.item_indices.get(id).copied() {
            self.items.remove(idx);
            self.selected.remove(id);
            self.selected_order.retain(|s| s != id);
            if self.focus.as_deref() == Some(id) {
                self.focus = None;
            }
            if self.anchor.as_deref() == Some(id) {
                self.anchor = None;
            }
            self.rebuild_indices();
            self.bump_version();
        }
    }

    /// Clear all items.
    pub fn clear_items(&mut self) {
        self.items.clear();
        self.item_indices.clear();
        self.selected.clear();
        self.selected_order.clear();
        self.focus = None;
        self.anchor = None;
        self.bump_version();
    }

    /// Total number of items.
    pub fn item_count(&self) -> usize {
        self.items.len()
    }

    /// Get the item ID at an index.
    pub fn item_id(&self, index: usize) -> String {
        self.items.get(index).cloned().unwrap_or_default()
    }

    /// Get the index of an item by ID (-1 if not found).
    pub fn item_index(&self, id: &str) -> i32 {
        self.item_indices
            .get(id)
            .map(|&idx| idx as i32)
            .unwrap_or(-1)
    }

    // ── Selection ─────────────────────────────────────────────────────

    /// Select an item by ID.
    pub fn select(&mut self, id: &str) {
        if self.mode == 0 {
            // Single mode: deselect previous before selecting new
            self.selected.clear();
            self.selected_order.clear();
        }
        let id_str = id.to_string();
        if self.selected.insert(id_str.clone()) {
            self.selected_order.push(id_str);
        }
        self.bump_version();
    }

    /// Deselect an item by ID.
    pub fn deselect(&mut self, id: &str) {
        if self.selected.remove(id) {
            self.selected_order.retain(|s| s != id);
        }
        self.bump_version();
    }

    /// Toggle an item's selection.
    pub fn toggle(&mut self, id: &str) {
        if self.selected.contains(id) {
            self.selected.remove(id);
            self.selected_order.retain(|s| s != id);
        } else {
            if self.mode == 0 {
                self.selected.clear();
                self.selected_order.clear();
            }
            let id_str = id.to_string();
            self.selected.insert(id_str.clone());
            self.selected_order.push(id_str);
        }
        self.bump_version();
    }

    /// Select a range of items between two IDs.
    pub fn select_range(&mut self, from_id: &str, to_id: &str) {
        let from_idx = self.item_indices.get(from_id).copied();
        let to_idx = self.item_indices.get(to_id).copied();

        if let (Some(from), Some(to)) = (from_idx, to_idx) {
            let start = from.min(to);
            let end = from.max(to);
            for i in start..=end {
                if let Some(item_id) = self.items.get(i) {
                    let id_str = item_id.clone();
                    if self.selected.insert(id_str.clone()) {
                        self.selected_order.push(id_str);
                    }
                }
            }
            self.bump_version();
        }
    }

    /// Select all items.
    pub fn select_all(&mut self) {
        for item in &self.items {
            if self.selected.insert(item.clone()) {
                self.selected_order.push(item.clone());
            }
        }
        self.bump_version();
    }

    /// Deselect all items.
    pub fn deselect_all(&mut self) {
        self.selected.clear();
        self.selected_order.clear();
        self.bump_version();
    }

    /// Whether an item is selected.
    pub fn is_selected(&self, id: &str) -> bool {
        self.selected.contains(id)
    }

    /// Number of selected items.
    pub fn selected_count(&self) -> usize {
        self.selected.len()
    }

    /// Get a selected item ID by index (in selection order).
    pub fn selected_id(&self, index: usize) -> String {
        self.selected_order.get(index).cloned().unwrap_or_default()
    }

    // ── Focus ─────────────────────────────────────────────────────────

    /// Set the focused item.
    pub fn set_focus(&mut self, id: &str) {
        self.focus = Some(id.to_string());
        self.bump_version();
    }

    /// Get the focused item ID.
    pub fn focus(&self) -> String {
        self.focus.clone().unwrap_or_default()
    }

    /// Whether an item is focused.
    pub fn is_focused(&self, id: &str) -> bool {
        self.focus.as_deref() == Some(id)
    }

    // ── Anchor ────────────────────────────────────────────────────────

    /// Set the anchor item for range selection.
    pub fn set_anchor(&mut self, id: &str) {
        self.anchor = Some(id.to_string());
        self.bump_version();
    }

    /// Get the anchor item ID.
    pub fn anchor(&self) -> String {
        self.anchor.clone().unwrap_or_default()
    }

    /// Clear the anchor.
    pub fn clear_anchor(&mut self) {
        self.anchor = None;
        self.bump_version();
    }

    // ── Keyboard ──────────────────────────────────────────────────────

    /// Move focus in a direction (0=up,1=down,2=left,3=right).
    pub fn move_focus(&mut self, direction: u8) {
        if self.items.is_empty() {
            return;
        }

        let current_idx = self
            .focus
            .as_ref()
            .and_then(|id| self.item_indices.get(id.as_str()).copied());

        let new_idx = match current_idx {
            None => 0, // No focus yet, start at first item
            Some(idx) => {
                match direction {
                    0 => {
                        // Up: decrement, clamp at 0
                        if idx > 0 { idx - 1 } else { 0 }
                    }
                    1 => {
                        // Down: increment, clamp at last
                        if idx < self.items.len() - 1 {
                            idx + 1
                        } else {
                            self.items.len() - 1
                        }
                    }
                    // Left/Right: same as up/down for flat lists
                    2 => {
                        if idx > 0 { idx - 1 } else { 0 }
                    }
                    3 => {
                        if idx < self.items.len() - 1 {
                            idx + 1
                        } else {
                            self.items.len() - 1
                        }
                    }
                    _ => idx,
                }
            }
        };

        if let Some(id) = self.items.get(new_idx) {
            self.focus = Some(id.clone());
        }
        self.bump_version();
    }

    /// Activate (select) the focused item.
    pub fn activate_focus(&mut self) {
        if let Some(ref focus_id) = self.focus.clone() {
            if self.mode == 0 {
                self.selected.clear();
                self.selected_order.clear();
            }
            if self.selected.insert(focus_id.clone()) {
                self.selected_order.push(focus_id.clone());
            }
            self.bump_version();
        }
    }

    // ── Reset ─────────────────────────────────────────────────────────

    /// Reset all state to defaults.
    pub fn reset(&mut self) {
        self.mode = 0;
        self.items.clear();
        self.item_indices.clear();
        self.selected.clear();
        self.selected_order.clear();
        self.focus = None;
        self.anchor = None;
        self.bump_version();
    }
}

// ── Private implementation ─────────────────────────────────────────────────

impl SelectionEngine {
    /// Rebuild the item_indices HashMap from the items Vec.
    fn rebuild_indices(&mut self) {
        self.item_indices.clear();
        for (i, id) in self.items.iter().enumerate() {
            self.item_indices.insert(id.clone(), i);
        }
    }
}

// ── Helpers — lightweight JSON parsing without serde ────────────────────────

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

fn skip_whitespace_and_commas(chars: &mut std::iter::Peekable<std::str::Chars>) {
    while chars
        .peek()
        .map_or(false, |c| *c == ' ' || *c == ',' || *c == '\n' || *c == '\r' || *c == '\t')
    {
        chars.next();
    }
}
