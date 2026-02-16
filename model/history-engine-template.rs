// ============================================================================
// HISTORY ENGINE TEMPLATE — Rust/WASM Undo/Redo State Machine
// ============================================================================
//
// HOW TO USE THIS TEMPLATE:
//
// 1. COPY this file and rename it (e.g., history-engine.rs).
//
// 2. THE PATTERN:
//    - JS performs a user action → serializes a command descriptor to JSON
//    - JS calls push_command(json) to record the action
//    - User hits Ctrl+Z → JS calls undo() → gets back the command JSON
//    - JS interprets the returned JSON to reverse the action
//    - User hits Ctrl+Shift+Z → JS calls redo() → gets back the command JSON
//    - JS interprets the returned JSON to re-apply the action
//
// 3. COMMAND FORMAT:
//    Commands are opaque JSON strings to this engine. A typical format:
//    ```json
//    {
//      "type": "field-change",
//      "label": "Changed username",
//      "fieldId": "username",
//      "oldValue": "alice",
//      "newValue": "bob"
//    }
//    ```
//    The engine only cares about the `label` field (for display purposes).
//    Everything else is passed through verbatim to JS on undo/redo.
//
// 4. CHECKPOINTS:
//    Call set_checkpoint() to mark the current position as "saved."
//    is_dirty() returns true if the current position differs from the
//    checkpoint. Use this for "unsaved changes" indicators.
//
// 5. CAPACITY:
//    max_history (default 100) limits the undo stack size. When exceeded,
//    the oldest entries are dropped and the checkpoint index is adjusted.
//    This prevents unbounded memory growth for long editing sessions.
//
// 6. LABEL EXTRACTION:
//    The engine extracts command labels for display without serde — it uses
//    a simple string search for `"label":"..."` in the JSON. This keeps
//    the WASM binary small. If you need structured parsing, add serde_json.
//
// 7. BATCH COMMANDS:
//    For compound operations (e.g., "delete 5 items"), push a single command
//    whose JSON contains all the sub-operations. The engine treats it as one
//    undo step. Example:
//    ```json
//    {
//      "type": "batch",
//      "label": "Deleted 5 items",
//      "commands": [
//        {"type": "delete", "id": "1", ...},
//        {"type": "delete", "id": "2", ...}
//      ]
//    }
//    ```
//
// 8. INTEGRATION WITH OTHER ENGINES:
//    The history engine doesn't mutate application state directly. It's a
//    command journal. Your controller layer reads the returned JSON from
//    undo/redo and applies the changes to the form-engine, table-engine, etc.
//
// ============================================================================

use wasm_bindgen::prelude::*;

// ── HistoryEngine ──────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct HistoryEngine {
    undo_stack: Vec<String>,
    redo_stack: Vec<String>,
    checkpoint_index: Option<usize>,
    max_history: usize,
    data_version: u32,
}

#[wasm_bindgen]
impl HistoryEngine {
    // ── Constructor ────────────────────────────────────────────────────

    #[wasm_bindgen(constructor)]
    pub fn new() -> HistoryEngine {
        HistoryEngine {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            checkpoint_index: None,
            max_history: 100,
            data_version: 0,
        }
    }

    /// Create with a custom max history size.
    #[wasm_bindgen]
    pub fn with_max_history(max: usize) -> HistoryEngine {
        HistoryEngine {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            checkpoint_index: None,
            max_history: if max == 0 { 100 } else { max },
            data_version: 0,
        }
    }

    // ── Version tracking ───────────────────────────────────────────────

    #[wasm_bindgen(getter)]
    pub fn data_version(&self) -> u32 {
        self.data_version
    }

    fn bump_version(&mut self) {
        self.data_version = self.data_version.wrapping_add(1);
    }

    // ── Push command ───────────────────────────────────────────────────

    /// Record a new command. Clears the redo stack (branching history).
    /// The `command_json` is an opaque JSON string — the engine stores it
    /// verbatim and returns it on undo/redo.
    #[wasm_bindgen]
    pub fn push_command(&mut self, command_json: &str) {
        // Clear redo stack — new action branches off from here
        self.redo_stack.clear();

        // Push onto undo stack
        self.undo_stack.push(command_json.to_string());

        // Enforce capacity limit
        self.enforce_capacity();

        self.bump_version();
    }

    // ── Undo ───────────────────────────────────────────────────────────

    /// Pop the most recent command from the undo stack and push it onto
    /// the redo stack. Returns the command JSON so JS can reverse it.
    /// Returns empty string if there's nothing to undo.
    #[wasm_bindgen]
    pub fn undo(&mut self) -> String {
        match self.undo_stack.pop() {
            Some(command) => {
                self.redo_stack.push(command.clone());
                self.bump_version();
                command
            }
            None => String::new(),
        }
    }

    // ── Redo ───────────────────────────────────────────────────────────

    /// Pop the most recent command from the redo stack and push it onto
    /// the undo stack. Returns the command JSON so JS can re-apply it.
    /// Returns empty string if there's nothing to redo.
    #[wasm_bindgen]
    pub fn redo(&mut self) -> String {
        match self.redo_stack.pop() {
            Some(command) => {
                self.undo_stack.push(command.clone());
                self.bump_version();
                command
            }
            None => String::new(),
        }
    }

    // ── Stack state queries ────────────────────────────────────────────

    /// Check if undo is available.
    #[wasm_bindgen]
    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    /// Check if redo is available.
    #[wasm_bindgen]
    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    /// Number of commands on the undo stack.
    #[wasm_bindgen]
    pub fn undo_count(&self) -> usize {
        self.undo_stack.len()
    }

    /// Number of commands on the redo stack.
    #[wasm_bindgen]
    pub fn redo_count(&self) -> usize {
        self.redo_stack.len()
    }

    // ── Peek ───────────────────────────────────────────────────────────

    /// Peek at the top of the undo stack without popping.
    /// Returns empty string if the stack is empty.
    #[wasm_bindgen]
    pub fn peek_undo(&self) -> String {
        self.undo_stack.last().cloned().unwrap_or_default()
    }

    /// Peek at the top of the redo stack without popping.
    /// Returns empty string if the stack is empty.
    #[wasm_bindgen]
    pub fn peek_redo(&self) -> String {
        self.redo_stack.last().cloned().unwrap_or_default()
    }

    /// Get the label of the top undo command (for "Undo: <label>" display).
    /// Extracts the "label" field from JSON without serde.
    #[wasm_bindgen]
    pub fn peek_undo_label(&self) -> String {
        self.undo_stack
            .last()
            .map(|json| extract_label(json))
            .unwrap_or_default()
    }

    /// Get the label of the top redo command.
    #[wasm_bindgen]
    pub fn peek_redo_label(&self) -> String {
        self.redo_stack
            .last()
            .map(|json| extract_label(json))
            .unwrap_or_default()
    }

    // ── Checkpoint (saved state) ───────────────────────────────────────

    /// Mark the current undo stack position as the "saved" checkpoint.
    /// After this, is_dirty() returns false until the stack position changes.
    #[wasm_bindgen]
    pub fn set_checkpoint(&mut self) {
        self.checkpoint_index = Some(self.undo_stack.len());
        self.bump_version();
    }

    /// Returns true if the current position differs from the checkpoint.
    /// Use this for "unsaved changes" indicators.
    #[wasm_bindgen]
    pub fn is_dirty(&self) -> bool {
        match self.checkpoint_index {
            Some(idx) => self.undo_stack.len() != idx,
            None => !self.undo_stack.is_empty(),
        }
    }

    /// Clear the checkpoint (treat everything as unsaved).
    #[wasm_bindgen]
    pub fn clear_checkpoint(&mut self) {
        self.checkpoint_index = None;
        self.bump_version();
    }

    // ── Capacity management ────────────────────────────────────────────

    #[wasm_bindgen(getter)]
    pub fn max_history(&self) -> usize {
        self.max_history
    }

    #[wasm_bindgen(setter)]
    pub fn set_max_history(&mut self, max: usize) {
        self.max_history = if max == 0 { 100 } else { max };
        self.enforce_capacity();
        self.bump_version();
    }

    // ── Clear ──────────────────────────────────────────────────────────

    /// Clear both stacks and reset checkpoint.
    #[wasm_bindgen]
    pub fn clear(&mut self) {
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.checkpoint_index = None;
        self.bump_version();
    }

    /// Clear only the redo stack (e.g., after a destructive operation).
    #[wasm_bindgen]
    pub fn clear_redo(&mut self) {
        self.redo_stack.clear();
        self.bump_version();
    }

    // ── History labels (for UI display) ────────────────────────────────

    /// Return the last N undo labels as a JSON array for display.
    /// Most recent first: ["Changed name", "Added row", "Deleted item"]
    #[wasm_bindgen]
    pub fn undo_labels_json(&self, count: usize) -> String {
        let labels: Vec<String> = self
            .undo_stack
            .iter()
            .rev()
            .take(count)
            .map(|json| format!("\"{}\"", escape_json_string(&extract_label(json))))
            .collect();
        format!("[{}]", labels.join(","))
    }

    /// Return the last N redo labels as a JSON array for display.
    #[wasm_bindgen]
    pub fn redo_labels_json(&self, count: usize) -> String {
        let labels: Vec<String> = self
            .redo_stack
            .iter()
            .rev()
            .take(count)
            .map(|json| format!("\"{}\"", escape_json_string(&extract_label(json))))
            .collect();
        format!("[{}]", labels.join(","))
    }

    // ── Snapshot / Restore ─────────────────────────────────────────────

    /// Export the full history state as a JSON string for persistence.
    #[wasm_bindgen]
    pub fn snapshot_json(&self) -> String {
        let undo_items: Vec<String> = self
            .undo_stack
            .iter()
            .map(|s| format!("\"{}\"", escape_json_string(s)))
            .collect();
        let redo_items: Vec<String> = self
            .redo_stack
            .iter()
            .map(|s| format!("\"{}\"", escape_json_string(s)))
            .collect();

        format!(
            concat!(
                "{{",
                "\"undoStack\":[{}],",
                "\"redoStack\":[{}],",
                "\"checkpointIndex\":{},",
                "\"maxHistory\":{},",
                "\"dataVersion\":{}",
                "}}"
            ),
            undo_items.join(","),
            redo_items.join(","),
            match self.checkpoint_index {
                Some(idx) => idx.to_string(),
                None => "null".to_string(),
            },
            self.max_history,
            self.data_version,
        )
    }
}

// ── Private implementation ─────────────────────────────────────────────────

impl HistoryEngine {
    /// Drop oldest undo entries when over capacity. Adjusts checkpoint index.
    fn enforce_capacity(&mut self) {
        if self.undo_stack.len() > self.max_history {
            let overflow = self.undo_stack.len() - self.max_history;
            self.undo_stack.drain(0..overflow);

            // Adjust checkpoint — if the checkpoint was in the dropped region,
            // it's gone and we treat everything as dirty.
            self.checkpoint_index = match self.checkpoint_index {
                Some(idx) if idx <= overflow => None, // Checkpoint was dropped
                Some(idx) => Some(idx - overflow),    // Shift back
                None => None,
            };
        }
    }
}

// ── Helpers — lightweight JSON label extraction without serde ───────────────

/// Extract the "label" field from a JSON string.
/// Looks for `"label":"some text"` using simple string scanning.
/// Returns empty string if not found.
fn extract_label(json: &str) -> String {
    let needle = "\"label\":\"";
    let start = match json.find(needle) {
        Some(pos) => pos + needle.len(),
        None => return String::new(),
    };

    let rest = &json[start..];
    let mut result = String::new();
    let mut chars = rest.chars();

    loop {
        match chars.next() {
            Some('\\') => {
                // Escaped character — take next char literally
                if let Some(c) = chars.next() {
                    result.push(c);
                }
            }
            Some('"') => break,
            Some(c) => result.push(c),
            None => break, // Unterminated string — return what we have
        }
    }

    result
}

/// Escape a string for embedding in JSON (backslash and double-quote).
fn escape_json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out
}
