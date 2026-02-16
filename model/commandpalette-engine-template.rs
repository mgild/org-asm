// ============================================================================
// COMMAND PALETTE ENGINE TEMPLATE — Rust/WASM Command Palette State Machine
// ============================================================================
//
// HOW TO USE THIS TEMPLATE:
//
// 1. COPY this file and rename it (e.g., commandpalette-engine.rs).
//
// 2. THE PATTERN:
//    - JS calls register_command(id, label, category, keybinding)
//    - JS calls set_query("text"), set_enabled(id, bool), etc.
//    - Engine lazily recomputes fuzzy match results when state is read (dirty flag)
//    - JS reads results via result_id(index), result_label(index), result_score(index)
//    - Keybinding resolution via resolve_keybinding(combo)
//
// 3. LAZY RECOMPUTATION:
//    Mutations (set_query, register_command, set_enabled, etc.) set results_dirty=true.
//    Reads (result_count, result_id, etc.) call compute_results() if dirty.
//    This avoids redundant computation when multiple mutations happen
//    before a read (e.g., register_command + set_query).
//
// 4. FUZZY MATCH:
//    Subsequence matching with gap penalty + recency boost from execution count.
//    For each char in query, find in label (case-insensitive).
//    Score = matches/query_len - 0.01 per gap. Recency boost = min(exec_count * 0.1, 1.0).
//    Empty query matches all enabled commands with score 1.0.
//
// 5. KEYBINDING NORMALIZATION:
//    Lowercase, split by '+', sort modifiers (alt, cmd/meta, ctrl/control, shift),
//    rejoin. Synonyms: cmd=meta, ctrl=control.
//
// 6. PAGINATION:
//    Default page_size = 50. Results are paginated: result_id(0) through
//    result_id(page_size-1) return commands within the current page.
//
// ============================================================================

use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ── CommandEntry ──────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct CommandEntry {
    id: String,
    label: String,
    category: String,
    keybinding: String,
    enabled: bool,
}

// ── CommandPaletteEngine ──────────────────────────────────────────────────

#[wasm_bindgen]
pub struct CommandPaletteEngine {
    commands: Vec<CommandEntry>,
    command_map: HashMap<String, usize>,        // id -> index in commands
    keybindings: HashMap<String, String>,        // normalized combo -> command id
    execution_counts: HashMap<String, u32>,
    last_executed: String,
    query: String,
    results: Vec<(usize, f64)>,                  // (command_index, score)
    page: usize,
    page_size: usize,
    results_dirty: bool,
    data_version: u32,
}

#[wasm_bindgen]
impl CommandPaletteEngine {
    // ── Constructor ────────────────────────────────────────────────────

    #[wasm_bindgen(constructor)]
    pub fn new() -> CommandPaletteEngine {
        CommandPaletteEngine {
            commands: Vec::new(),
            command_map: HashMap::new(),
            keybindings: HashMap::new(),
            execution_counts: HashMap::new(),
            last_executed: String::new(),
            query: String::new(),
            results: Vec::new(),
            page: 0,
            page_size: 50,
            results_dirty: false,
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
        self.results_dirty = true;
        self.bump_version();
    }

    // ── Registration ───────────────────────────────────────────────────

    /// Register a command with ID, label, category, and keybinding.
    pub fn register_command(&mut self, id: &str, label: &str, category: &str, keybinding: &str) {
        // If command already exists, update it
        if let Some(&idx) = self.command_map.get(id) {
            let cmd = &mut self.commands[idx];
            // Remove old keybinding
            if !cmd.keybinding.is_empty() {
                let old_norm = normalize_keybinding(&cmd.keybinding);
                self.keybindings.remove(&old_norm);
            }
            cmd.label = label.to_string();
            cmd.category = category.to_string();
            cmd.keybinding = keybinding.to_string();
            if !keybinding.is_empty() {
                let norm = normalize_keybinding(keybinding);
                self.keybindings.insert(norm, id.to_string());
            }
        } else {
            let idx = self.commands.len();
            self.commands.push(CommandEntry {
                id: id.to_string(),
                label: label.to_string(),
                category: category.to_string(),
                keybinding: keybinding.to_string(),
                enabled: true,
            });
            self.command_map.insert(id.to_string(), idx);
            if !keybinding.is_empty() {
                let norm = normalize_keybinding(keybinding);
                self.keybindings.insert(norm, id.to_string());
            }
        }
        self.page = 0;
        self.mark_dirty();
    }

    /// Unregister a command by ID.
    pub fn unregister_command(&mut self, id: &str) {
        if let Some(&idx) = self.command_map.get(id) {
            let cmd = &self.commands[idx];
            if !cmd.keybinding.is_empty() {
                let norm = normalize_keybinding(&cmd.keybinding);
                self.keybindings.remove(&norm);
            }
            self.commands.remove(idx);
            self.command_map.remove(id);
            // Rebuild command_map indices after removal
            self.command_map.clear();
            for (i, cmd) in self.commands.iter().enumerate() {
                self.command_map.insert(cmd.id.clone(), i);
            }
            self.page = 0;
            self.mark_dirty();
        }
    }

    /// Number of registered commands.
    pub fn command_count(&self) -> usize {
        self.commands.len()
    }

    /// Get a command ID by index.
    pub fn command_id(&self, index: usize) -> String {
        self.commands
            .get(index)
            .map(|c| c.id.clone())
            .unwrap_or_default()
    }

    /// Get a command label by ID.
    pub fn command_label(&self, id: &str) -> String {
        self.command_map
            .get(id)
            .and_then(|&idx| self.commands.get(idx))
            .map(|c| c.label.clone())
            .unwrap_or_default()
    }

    /// Get a command category by ID.
    pub fn command_category(&self, id: &str) -> String {
        self.command_map
            .get(id)
            .and_then(|&idx| self.commands.get(idx))
            .map(|c| c.category.clone())
            .unwrap_or_default()
    }

    // ── Enabled ────────────────────────────────────────────────────────

    /// Set whether a command is enabled.
    pub fn set_enabled(&mut self, id: &str, enabled: bool) {
        if let Some(&idx) = self.command_map.get(id) {
            self.commands[idx].enabled = enabled;
            self.mark_dirty();
        }
    }

    /// Whether a command is enabled.
    pub fn is_enabled(&self, id: &str) -> bool {
        self.command_map
            .get(id)
            .and_then(|&idx| self.commands.get(idx))
            .map(|c| c.enabled)
            .unwrap_or(false)
    }

    // ── Search ─────────────────────────────────────────────────────────

    /// Set the search query text.
    pub fn set_query(&mut self, text: &str) {
        self.query = text.to_string();
        self.page = 0;
        self.mark_dirty();
    }

    /// Get the current search query.
    pub fn query(&self) -> String {
        self.query.clone()
    }

    /// Number of search results.
    pub fn result_count(&mut self) -> usize {
        self.ensure_computed();
        self.results.len()
    }

    /// Get the command ID of a result at index (within current page).
    pub fn result_id(&mut self, index: usize) -> String {
        self.ensure_computed();
        let global_idx = self.page * self.page_size + index;
        if global_idx >= self.results.len() {
            return String::new();
        }
        let (cmd_idx, _) = self.results[global_idx];
        self.commands
            .get(cmd_idx)
            .map(|c| c.id.clone())
            .unwrap_or_default()
    }

    /// Get the label of a result at index (within current page).
    pub fn result_label(&mut self, index: usize) -> String {
        self.ensure_computed();
        let global_idx = self.page * self.page_size + index;
        if global_idx >= self.results.len() {
            return String::new();
        }
        let (cmd_idx, _) = self.results[global_idx];
        self.commands
            .get(cmd_idx)
            .map(|c| c.label.clone())
            .unwrap_or_default()
    }

    /// Get the category of a result at index (within current page).
    pub fn result_category(&mut self, index: usize) -> String {
        self.ensure_computed();
        let global_idx = self.page * self.page_size + index;
        if global_idx >= self.results.len() {
            return String::new();
        }
        let (cmd_idx, _) = self.results[global_idx];
        self.commands
            .get(cmd_idx)
            .map(|c| c.category.clone())
            .unwrap_or_default()
    }

    /// Get the score of a result at index (within current page).
    pub fn result_score(&mut self, index: usize) -> f64 {
        self.ensure_computed();
        let global_idx = self.page * self.page_size + index;
        if global_idx >= self.results.len() {
            return 0.0;
        }
        self.results[global_idx].1
    }

    // ── Keybindings ────────────────────────────────────────────────────

    /// Resolve a key combo to a command ID.
    pub fn resolve_keybinding(&self, key_combo: &str) -> String {
        let norm = normalize_keybinding(key_combo);
        self.keybindings
            .get(&norm)
            .cloned()
            .unwrap_or_default()
    }

    /// Get the keybinding for a command.
    pub fn keybinding(&self, command_id: &str) -> String {
        self.command_map
            .get(command_id)
            .and_then(|&idx| self.commands.get(idx))
            .map(|c| c.keybinding.clone())
            .unwrap_or_default()
    }

    /// Set the keybinding for a command.
    pub fn set_keybinding(&mut self, command_id: &str, keybinding: &str) {
        if let Some(&idx) = self.command_map.get(command_id) {
            let cmd = &mut self.commands[idx];
            // Remove old keybinding
            if !cmd.keybinding.is_empty() {
                let old_norm = normalize_keybinding(&cmd.keybinding);
                self.keybindings.remove(&old_norm);
            }
            cmd.keybinding = keybinding.to_string();
            if !keybinding.is_empty() {
                let norm = normalize_keybinding(keybinding);
                self.keybindings.insert(norm, command_id.to_string());
            }
            self.bump_version();
        }
    }

    // ── Execution ──────────────────────────────────────────────────────

    /// Mark a command as executed (increments execution count).
    pub fn mark_executed(&mut self, id: &str) {
        let count = self.execution_counts.entry(id.to_string()).or_insert(0);
        *count += 1;
        self.last_executed = id.to_string();
        self.mark_dirty();
    }

    /// Get the last executed command ID.
    pub fn last_executed_id(&self) -> String {
        self.last_executed.clone()
    }

    /// Get the execution count for a command.
    pub fn execution_count(&self, id: &str) -> u32 {
        self.execution_counts.get(id).copied().unwrap_or(0)
    }

    // ── Pagination ─────────────────────────────────────────────────────

    /// Set the current page (0-based).
    pub fn set_page(&mut self, page: usize) {
        self.page = page;
        self.bump_version();
    }

    /// Set the page size.
    pub fn set_page_size(&mut self, size: usize) {
        self.page_size = if size == 0 { 50 } else { size };
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
        let total = self.results.len();
        if total == 0 {
            0
        } else {
            (total + self.page_size - 1) / self.page_size
        }
    }

    // ── Reset ──────────────────────────────────────────────────────────

    /// Reset all state to defaults.
    pub fn reset(&mut self) {
        self.commands.clear();
        self.command_map.clear();
        self.keybindings.clear();
        self.execution_counts.clear();
        self.last_executed.clear();
        self.query.clear();
        self.results.clear();
        self.page = 0;
        self.page_size = 50;
        self.results_dirty = false;
        self.bump_version();
    }
}

// ── Private implementation ─────────────────────────────────────────────────

impl CommandPaletteEngine {
    /// Recompute results if dirty.
    fn ensure_computed(&mut self) {
        if self.results_dirty {
            self.compute_results();
            self.results_dirty = false;
        }
    }

    /// Full recomputation: iterate enabled commands, score each against query,
    /// sort descending by score.
    fn compute_results(&mut self) {
        self.results.clear();

        for (i, cmd) in self.commands.iter().enumerate() {
            if !cmd.enabled {
                continue;
            }

            let score = if self.query.is_empty() {
                // Empty query matches all enabled commands
                1.0
            } else {
                fuzzy_score(&cmd.label, &self.query)
            };

            if score > 0.0 {
                // Add recency boost: execution_count * 0.1, capped at 1.0
                let exec_count = self.execution_counts.get(&cmd.id).copied().unwrap_or(0);
                let recency_boost = (exec_count as f64 * 0.1).min(1.0);
                self.results.push((i, score + recency_boost));
            }
        }

        // Sort descending by score
        self.results.sort_by(|a, b| {
            b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)
        });
    }
}

// ── Fuzzy matching ──────────────────────────────────────────────────────────

/// Subsequence fuzzy matching with gap penalty.
///
/// For each char in query, find it in label (case-insensitive).
/// Score = matches / query_len, with a 0.01 penalty per gap character.
/// Returns 0.0 if any query character is not found.
fn fuzzy_score(label: &str, query: &str) -> f64 {
    if query.is_empty() {
        return 1.0;
    }

    let label_lower: Vec<char> = label.chars().flat_map(|c| c.to_lowercase()).collect();
    let query_lower: Vec<char> = query.chars().flat_map(|c| c.to_lowercase()).collect();

    let mut li = 0;
    let mut matched = 0;
    let mut gaps = 0;

    for &qc in &query_lower {
        let mut found = false;
        while li < label_lower.len() {
            if label_lower[li] == qc {
                matched += 1;
                li += 1;
                found = true;
                break;
            }
            if matched > 0 {
                gaps += 1;
            }
            li += 1;
        }
        if !found {
            return 0.0;
        }
    }

    let base_score = matched as f64 / query_lower.len() as f64;
    (base_score - gaps as f64 * 0.01).max(0.0)
}

// ── Keybinding normalization ────────────────────────────────────────────────

/// Normalize a keybinding string:
/// - Lowercase
/// - Split by '+'
/// - Map synonyms: cmd -> meta, ctrl -> control
/// - Sort modifier keys (alt, meta, control, shift)
/// - Non-modifier keys stay at end in original order
/// - Rejoin with '+'
fn normalize_keybinding(combo: &str) -> String {
    let parts: Vec<&str> = combo.split('+').map(|p| p.trim()).collect();
    let mut modifiers = Vec::new();
    let mut keys = Vec::new();

    for part in parts {
        let lower = part.to_lowercase();
        let mapped = match lower.as_str() {
            "cmd" | "meta" => "meta".to_string(),
            "ctrl" | "control" => "control".to_string(),
            other => other.to_string(),
        };

        match mapped.as_str() {
            "alt" | "meta" | "control" | "shift" => modifiers.push(mapped),
            _ => keys.push(mapped),
        }
    }

    modifiers.sort();
    modifiers.extend(keys);
    modifiers.join("+")
}
