// ============================================================================
// STATE MACHINE ENGINE TEMPLATE — Rust/WASM Generic Finite State Machine
// ============================================================================
//
// HOW TO USE THIS TEMPLATE:
//
// 1. COPY this file and rename it (e.g., statemachine-engine.rs).
//
// 2. DEFINE YOUR STATES AND TRANSITIONS in `init_machine()`. This is the
//    primary customization point — called once from the constructor.
//
// 3. THE PATTERN:
//    - JS calls add_state("idle", '{"label":"Idle","meta":"{}"}')
//    - JS calls add_transition("idle", "START", "running")
//    - JS calls set_initial_state("idle")
//    - JS calls send_event("START") → engine transitions to "running"
//    - If a guard is set, send_event stashes pending → JS resolves later
//
// 4. TWO-PHASE GUARD PROTOCOL (same as router):
//    Phase 1: send_event() detects a guarded transition → sets pending state.
//    Phase 2: JS does async work, then calls resolve_guard(true/false).
//             If true → completes the transition.
//             If false → cancels, stays in current state.
//
// 5. PARALLEL STATE CHARTS:
//    active_states is a Vec<String>. For flat FSMs, it contains one element.
//    For parallel (orthogonal) regions, it contains one state per region.
//    is_in_state(id) checks all active states.
//
// 6. CONTEXT BAG:
//    Arbitrary JSON context stored as a String. set_context replaces it,
//    merge_context does a shallow merge of JSON keys. Useful for extended
//    state (XState-style context).
//
// 7. ACTIONS:
//    on_enter_action / on_exit_action return JSON action descriptors.
//    The controller layer reads these and performs side effects.
//
// ============================================================================

use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ── Internal types ─────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct StateEntry {
    label: String,
    meta: String,
    on_enter: String,
    on_exit: String,
}

#[derive(Clone, Debug)]
struct TransitionEntry {
    from_state: String,
    event: String,
    to_state: String,
}

// ── StateMachineEngine ─────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct StateMachineEngine {
    states: HashMap<String, StateEntry>,
    transitions: Vec<TransitionEntry>,
    guards: HashMap<String, String>, // "from:event" -> guard_id
    active_states: Vec<String>,
    previous_state: String,
    history: Vec<String>,
    context: String,
    pending_guard: Option<String>,     // guard_id
    pending_to_state: Option<String>,  // stashed destination
    pending_event: Option<String>,     // stashed event
    transition_count: u32,
    data_version: u32,
}

#[wasm_bindgen]
impl StateMachineEngine {
    // ── Constructor ────────────────────────────────────────────────────

    #[wasm_bindgen(constructor)]
    pub fn new() -> StateMachineEngine {
        let mut engine = StateMachineEngine {
            states: HashMap::new(),
            transitions: Vec::new(),
            guards: HashMap::new(),
            active_states: Vec::new(),
            previous_state: String::new(),
            history: Vec::new(),
            context: String::from("{}"),
            pending_guard: None,
            pending_to_state: None,
            pending_event: None,
            transition_count: 0,
            data_version: 0,
        };
        engine.init_machine();
        engine
    }

    // ── CUSTOMIZATION POINT ────────────────────────────────────────────

    /// Define your states and transitions here. Called once from the
    /// constructor.
    ///
    /// Example:
    /// ```rust
    /// self.add_state("idle", r#"{"label":"Idle","meta":"{}"}"#);
    /// self.add_state("loading", r#"{"label":"Loading","meta":"{}"}"#);
    /// self.add_state("success", r#"{"label":"Success","meta":"{}"}"#);
    /// self.add_state("error", r#"{"label":"Error","meta":"{}"}"#);
    /// self.add_transition("idle", "FETCH", "loading");
    /// self.add_transition("loading", "RESOLVE", "success");
    /// self.add_transition("loading", "REJECT", "error");
    /// self.add_transition("error", "RETRY", "loading");
    /// self.set_initial_state("idle");
    /// ```
    fn init_machine(&mut self) {
        // ── ADD YOUR STATES AND TRANSITIONS BELOW ──────────────────────
        //
        // ── END MACHINE DEFINITION ─────────────────────────────────────
    }

    // ── Version tracking ───────────────────────────────────────────────

    pub fn data_version(&self) -> u32 {
        self.data_version
    }

    fn bump_version(&mut self) {
        self.data_version = self.data_version.wrapping_add(1);
    }

    // ── Config (also callable from JS for dynamic machines) ────────────

    /// Add a state. json format: {"label":"My State","meta":"{}"}
    pub fn add_state(&mut self, id: &str, json: &str) {
        let label = extract_json_field(json, "label");
        let meta = extract_json_field(json, "meta");
        self.states.insert(
            id.to_string(),
            StateEntry {
                label,
                meta,
                on_enter: String::new(),
                on_exit: String::new(),
            },
        );
        self.bump_version();
    }

    /// Add a transition from one state to another on an event.
    pub fn add_transition(&mut self, from_state: &str, event: &str, to_state: &str) {
        self.transitions.push(TransitionEntry {
            from_state: from_state.to_string(),
            event: event.to_string(),
            to_state: to_state.to_string(),
        });
        self.bump_version();
    }

    /// Set the initial state. Clears active_states and sets to this one.
    pub fn set_initial_state(&mut self, id: &str) {
        self.active_states = vec![id.to_string()];
        self.history.push(id.to_string());
        self.bump_version();
    }

    /// Set a guard on a transition (from_state + event).
    pub fn set_guard(&mut self, from_state: &str, event: &str, guard_id: &str) {
        let key = format!("{}:{}", from_state, event);
        self.guards.insert(key, guard_id.to_string());
        self.bump_version();
    }

    // ── State queries ──────────────────────────────────────────────────

    /// Get the current state ID (first active state for flat FSMs).
    pub fn current_state(&self) -> String {
        self.active_states.first().cloned().unwrap_or_default()
    }

    /// Get the current state label.
    pub fn current_state_label(&self) -> String {
        let id = self.current_state();
        self.states
            .get(&id)
            .map(|s| s.label.clone())
            .unwrap_or_default()
    }

    /// Get the current state meta JSON.
    pub fn current_state_meta(&self) -> String {
        let id = self.current_state();
        self.states
            .get(&id)
            .map(|s| s.meta.clone())
            .unwrap_or_default()
    }

    // ── Transitions ────────────────────────────────────────────────────

    /// Send an event. Returns true if a transition was found (or guard pending).
    pub fn send_event(&mut self, event: &str) -> bool {
        if self.pending_guard.is_some() {
            return false; // Blocked by pending guard
        }

        let current = self.current_state();
        if current.is_empty() {
            return false;
        }

        // Find matching transition
        let transition = self
            .transitions
            .iter()
            .find(|t| t.from_state == current && t.event == event);

        let transition = match transition {
            Some(t) => t.clone(),
            None => return false,
        };

        // Check for guard
        let guard_key = format!("{}:{}", current, event);
        if let Some(guard_id) = self.guards.get(&guard_key) {
            // Two-phase: stash pending
            self.pending_guard = Some(guard_id.clone());
            self.pending_to_state = Some(transition.to_state);
            self.pending_event = Some(event.to_string());
            self.bump_version();
            return true;
        }

        // Direct transition
        self.apply_transition(&transition.to_state);
        true
    }

    /// Whether an event can be sent from the current state.
    pub fn can_send(&self, event: &str) -> bool {
        if self.pending_guard.is_some() {
            return false;
        }
        let current = self.current_state();
        self.transitions
            .iter()
            .any(|t| t.from_state == current && t.event == event)
    }

    /// Number of available events from the current state.
    pub fn available_event_count(&self) -> usize {
        let current = self.current_state();
        self.transitions
            .iter()
            .filter(|t| t.from_state == current)
            .count()
    }

    /// Get an available event by index.
    pub fn available_event(&self, index: usize) -> String {
        let current = self.current_state();
        self.transitions
            .iter()
            .filter(|t| t.from_state == current)
            .nth(index)
            .map(|t| t.event.clone())
            .unwrap_or_default()
    }

    // ── Guards ─────────────────────────────────────────────────────────

    /// Get the pending guard ID (empty if none).
    pub fn pending_guard(&self) -> String {
        self.pending_guard.clone().unwrap_or_default()
    }

    /// Resolve a pending guard (true = allow transition, false = deny).
    pub fn resolve_guard(&mut self, allowed: bool) {
        if self.pending_guard.is_none() {
            return;
        }

        if allowed {
            if let Some(to_state) = self.pending_to_state.take() {
                self.pending_guard = None;
                self.pending_event = None;
                self.apply_transition(&to_state);
                return;
            }
        }

        // Cancel
        self.pending_guard = None;
        self.pending_to_state = None;
        self.pending_event = None;
        self.bump_version();
    }

    /// Get the guard ID for the pending transition.
    pub fn guard_id(&self) -> String {
        self.pending_guard.clone().unwrap_or_default()
    }

    // ── History ────────────────────────────────────────────────────────

    /// Get the previous state ID.
    pub fn previous_state(&self) -> String {
        self.previous_state.clone()
    }

    /// Total number of transitions that have occurred.
    pub fn transition_count(&self) -> u32 {
        self.transition_count
    }

    /// Number of states in the history.
    pub fn state_history_count(&self) -> usize {
        self.history.len()
    }

    /// Get a state from history by index.
    pub fn state_history(&self, index: usize) -> String {
        self.history.get(index).cloned().unwrap_or_default()
    }

    // ── Context ────────────────────────────────────────────────────────

    /// Set context from JSON (replaces existing).
    pub fn set_context(&mut self, json: &str) {
        self.context = json.to_string();
        self.bump_version();
    }

    /// Get context as JSON.
    pub fn context_json(&self) -> String {
        self.context.clone()
    }

    /// Merge JSON into existing context (shallow key merge).
    pub fn merge_context(&mut self, json: &str) {
        // Parse both contexts and merge
        let mut existing = parse_json_to_pairs(&self.context);
        let incoming = parse_json_to_pairs(json);

        for (k, v) in incoming {
            // Update or insert
            if let Some(entry) = existing.iter_mut().find(|(ek, _)| *ek == k) {
                entry.1 = v;
            } else {
                existing.push((k, v));
            }
        }

        // Serialize back to JSON
        let items: Vec<String> = existing
            .iter()
            .map(|(k, v)| format!("\"{}\":{}", k, v))
            .collect();
        self.context = format!("{{{}}}", items.join(","));
        self.bump_version();
    }

    // ── Parallel states ────────────────────────────────────────────────

    /// Number of active states (1 for flat FSM, >1 for parallel).
    pub fn active_state_count(&self) -> usize {
        self.active_states.len()
    }

    /// Get an active state by index.
    pub fn active_state(&self, index: usize) -> String {
        self.active_states.get(index).cloned().unwrap_or_default()
    }

    /// Whether a specific state is currently active.
    pub fn is_in_state(&self, id: &str) -> bool {
        self.active_states.iter().any(|s| s == id)
    }

    // ── Actions ────────────────────────────────────────────────────────

    /// Get the on-enter action descriptor JSON for a state.
    pub fn on_enter_action(&self, state_id: &str) -> String {
        self.states
            .get(state_id)
            .map(|s| s.on_enter.clone())
            .unwrap_or_default()
    }

    /// Get the on-exit action descriptor JSON for a state.
    pub fn on_exit_action(&self, state_id: &str) -> String {
        self.states
            .get(state_id)
            .map(|s| s.on_exit.clone())
            .unwrap_or_default()
    }

    // ── Reset ──────────────────────────────────────────────────────────

    /// Reset all state to defaults, then re-run init_machine().
    pub fn reset(&mut self) {
        self.states.clear();
        self.transitions.clear();
        self.guards.clear();
        self.active_states.clear();
        self.previous_state.clear();
        self.history.clear();
        self.context = String::from("{}");
        self.pending_guard = None;
        self.pending_to_state = None;
        self.pending_event = None;
        self.transition_count = 0;
        self.bump_version();
        self.init_machine();
    }
}

// ── Private implementation ─────────────────────────────────────────────────

impl StateMachineEngine {
    /// Apply a transition to a new state.
    fn apply_transition(&mut self, to_state: &str) {
        let from = self.current_state();
        self.previous_state = from;

        // Update active states (flat FSM: replace the single active state)
        if !self.active_states.is_empty() {
            self.active_states[0] = to_state.to_string();
        } else {
            self.active_states.push(to_state.to_string());
        }

        self.history.push(to_state.to_string());
        self.transition_count += 1;
        self.bump_version();
    }
}

// ── Helpers — lightweight JSON without serde ────────────────────────────────

/// Extract a string field from JSON: {"field":"value"} → "value"
fn extract_json_field(json: &str, field: &str) -> String {
    let needle = format!("\"{}\":\"", field);
    let start = match json.find(&needle) {
        Some(pos) => pos + needle.len(),
        None => return String::new(),
    };

    let rest = &json[start..];
    let mut result = String::new();
    let mut chars = rest.chars();

    loop {
        match chars.next() {
            Some('\\') => {
                if let Some(c) = chars.next() {
                    result.push(c);
                }
            }
            Some('"') => break,
            Some(c) => result.push(c),
            None => break,
        }
    }

    result
}

/// Parse JSON object into key-value pairs where values are raw JSON tokens.
/// E.g., {"a":"hello","b":42} → [("a", "\"hello\""), ("b", "42")]
fn parse_json_to_pairs(json: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let json = json.trim();
    if json.len() < 2 || !json.starts_with('{') || !json.ends_with('}') {
        return pairs;
    }

    let inner = &json[1..json.len() - 1];
    let mut chars = inner.chars().peekable();

    loop {
        // Skip whitespace and commas
        while chars.peek().map_or(false, |c| matches!(c, ' ' | ',' | '\n' | '\r' | '\t')) {
            chars.next();
        }

        if chars.peek().is_none() {
            break;
        }

        // Parse key (quoted string)
        if let Some(key) = parse_quoted_string(&mut chars) {
            // Skip : and whitespace
            while chars.peek().map_or(false, |c| *c == ':' || *c == ' ') {
                chars.next();
            }
            // Parse raw value token
            let value = parse_raw_value(&mut chars);
            pairs.push((key, value));
        } else {
            break;
        }
    }

    pairs
}

fn parse_quoted_string(chars: &mut std::iter::Peekable<std::str::Chars>) -> Option<String> {
    if chars.peek() != Some(&'"') {
        return None;
    }
    chars.next();
    let mut result = String::new();
    loop {
        match chars.next() {
            Some('\\') => {
                if let Some(c) = chars.next() {
                    result.push(c);
                }
            }
            Some('"') => return Some(result),
            Some(c) => result.push(c),
            None => return Some(result),
        }
    }
}

/// Parse a raw JSON value (string, number, bool, null, object, array).
fn parse_raw_value(chars: &mut std::iter::Peekable<std::str::Chars>) -> String {
    match chars.peek() {
        Some('"') => {
            // String value — capture with quotes
            let mut result = String::from("\"");
            chars.next();
            loop {
                match chars.next() {
                    Some('\\') => {
                        result.push('\\');
                        if let Some(c) = chars.next() {
                            result.push(c);
                        }
                    }
                    Some('"') => {
                        result.push('"');
                        return result;
                    }
                    Some(c) => result.push(c),
                    None => return result,
                }
            }
        }
        Some('{') | Some('[') => {
            // Nested object/array — capture with balanced braces
            let open = *chars.peek().unwrap();
            let close = if open == '{' { '}' } else { ']' };
            let mut result = String::new();
            let mut depth = 0;
            loop {
                match chars.next() {
                    Some(c) if c == open => {
                        depth += 1;
                        result.push(c);
                    }
                    Some(c) if c == close => {
                        depth -= 1;
                        result.push(c);
                        if depth == 0 {
                            return result;
                        }
                    }
                    Some(c) => result.push(c),
                    None => return result,
                }
            }
        }
        _ => {
            // Number, bool, or null — capture until delimiter
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
    }
}
