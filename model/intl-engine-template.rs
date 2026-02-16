// ============================================================================
// INTL ENGINE TEMPLATE — Rust/WASM Internationalization State Machine
// ============================================================================
//
// HOW TO USE THIS TEMPLATE:
//
// 1. COPY this file and rename it (e.g., intl-engine.rs).
//
// 2. THE PATTERN:
//    - JS calls set_locale("en") to change the active locale
//    - JS calls load_messages("en", json) to load translations
//    - JS calls translate("greeting") to get the translated string
//    - translate_with_params("hello", '{"name":"Alice"}') does interpolation
//    - translate_plural("items", 5) resolves pluralization rules
//
// 3. FALLBACK CHAIN:
//    translate() looks up the key in:
//      1. Current locale's catalog
//      2. Fallback locale's catalog
//      3. Returns the key itself as a last resort
//    Missing keys are tracked and queryable via missing_key_count/missing_key.
//
// 4. PLURALIZATION:
//    translate_plural("items", count) resolves:
//      - count == 0 → "items.zero" (falls back to "items.other")
//      - count == 1 → "items.one" (falls back to "items.other")
//      - else       → "items.other" (falls back to "items")
//
// 5. PARAMETER INTERPOLATION:
//    translate_with_params("hello", '{"name":"Alice"}') replaces {name} in
//    the translated string with "Alice". Unmatched params are left as-is.
//
// 6. MESSAGE FORMAT:
//    Messages are flat JSON: {"key":"value","key2":"value2"}.
//    No nested structures. Dot-notation keys (e.g., "items.one") are just
//    flat string keys. No serde — parsed with lightweight string scanning.
//
// ============================================================================

use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

// ── IntlEngine ─────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct IntlEngine {
    current_locale: String,
    fallback_locale: String,
    available_locales: Vec<String>,
    /// locale -> (key -> value)
    catalogs: HashMap<String, HashMap<String, String>>,
    missing_keys: Vec<String>,
    missing_set: HashSet<String>,
    data_version: u32,
}

#[wasm_bindgen]
impl IntlEngine {
    // ── Constructor ────────────────────────────────────────────────────

    #[wasm_bindgen(constructor)]
    pub fn new() -> IntlEngine {
        IntlEngine {
            current_locale: String::from("en"),
            fallback_locale: String::new(),
            available_locales: vec![String::from("en")],
            catalogs: HashMap::new(),
            missing_keys: Vec::new(),
            missing_set: HashSet::new(),
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

    // ── Locale management ──────────────────────────────────────────────

    /// Set the active locale.
    pub fn set_locale(&mut self, locale: &str) {
        self.current_locale = locale.to_string();
        self.bump_version();
    }

    /// Get the current active locale.
    pub fn current_locale(&self) -> String {
        self.current_locale.clone()
    }

    /// Number of available locales.
    pub fn available_locales_count(&self) -> usize {
        self.available_locales.len()
    }

    /// Get an available locale by index.
    pub fn available_locale(&self, index: usize) -> String {
        self.available_locales
            .get(index)
            .cloned()
            .unwrap_or_default()
    }

    /// Add a locale to the available set (no-op if already present).
    pub fn add_locale(&mut self, locale: &str) {
        if !self.available_locales.iter().any(|l| l == locale) {
            self.available_locales.push(locale.to_string());
        }
        self.bump_version();
    }

    // ── Catalog management ─────────────────────────────────────────────

    /// Load messages for a locale from flat JSON {"key":"value",...}.
    /// Merges with any existing messages for that locale.
    pub fn load_messages(&mut self, locale: &str, json: &str) {
        let messages = parse_flat_json(json);
        let catalog = self
            .catalogs
            .entry(locale.to_string())
            .or_insert_with(HashMap::new);
        for (k, v) in messages {
            catalog.insert(k, v);
        }
        self.bump_version();
    }

    /// Clear all messages for a locale.
    pub fn clear_messages(&mut self, locale: &str) {
        self.catalogs.remove(locale);
        self.bump_version();
    }

    // ── Translation ────────────────────────────────────────────────────

    /// Translate a key. Fallback chain: current → fallback → key.
    /// Tracks missing keys (translate is &mut self because of this).
    pub fn translate(&mut self, key: &str) -> String {
        // Try current locale
        if let Some(catalog) = self.catalogs.get(&self.current_locale) {
            if let Some(value) = catalog.get(key) {
                return value.clone();
            }
        }

        // Try fallback locale
        if !self.fallback_locale.is_empty() && self.fallback_locale != self.current_locale {
            if let Some(catalog) = self.catalogs.get(&self.fallback_locale) {
                if let Some(value) = catalog.get(key) {
                    return value.clone();
                }
            }
        }

        // Track missing key
        if !key.is_empty() && !self.missing_set.contains(key) {
            self.missing_set.insert(key.to_string());
            self.missing_keys.push(key.to_string());
            self.bump_version();
        }

        // Return key as-is
        key.to_string()
    }

    /// Translate with parameter interpolation.
    /// params_json is {"param":"value",...}. Replaces {param} in the result.
    pub fn translate_with_params(&mut self, key: &str, params_json: &str) -> String {
        let mut result = self.translate(key);
        let params = parse_flat_json(params_json);
        for (name, value) in params {
            let placeholder = format!("{{{}}}", name);
            result = result.replace(&placeholder, &value);
        }
        result
    }

    /// Translate with pluralization.
    /// count == 0 → key.zero (→ key.other)
    /// count == 1 → key.one (→ key.other)
    /// else       → key.other (→ key)
    pub fn translate_plural(&mut self, key: &str, count: u32) -> String {
        let suffix = match count {
            0 => "zero",
            1 => "one",
            _ => "other",
        };

        let specific_key = format!("{}.{}", key, suffix);

        // Try specific form (e.g., "items.zero")
        if let Some(value) = self.lookup_key(&specific_key) {
            return value;
        }

        // For zero and one, fall back to "other" form
        if suffix != "other" {
            let other_key = format!("{}.other", key);
            if let Some(value) = self.lookup_key(&other_key) {
                return value;
            }
        }

        // Fall back to base key
        self.translate(key)
    }

    // ── Missing keys ───────────────────────────────────────────────────

    /// Number of missing keys encountered so far.
    pub fn missing_key_count(&self) -> usize {
        self.missing_keys.len()
    }

    /// Get a missing key by index.
    pub fn missing_key(&self, index: usize) -> String {
        self.missing_keys.get(index).cloned().unwrap_or_default()
    }

    // ── Fallback ───────────────────────────────────────────────────────

    /// Set the fallback locale.
    pub fn set_fallback_locale(&mut self, locale: &str) {
        self.fallback_locale = locale.to_string();
        self.bump_version();
    }

    /// Get the fallback locale.
    pub fn fallback_locale(&self) -> String {
        self.fallback_locale.clone()
    }

    // ── Reset ──────────────────────────────────────────────────────────

    /// Reset all state to defaults.
    pub fn reset(&mut self) {
        self.current_locale = String::from("en");
        self.fallback_locale = String::new();
        self.available_locales = vec![String::from("en")];
        self.catalogs.clear();
        self.missing_keys.clear();
        self.missing_set.clear();
        self.bump_version();
    }
}

// ── Private implementation ─────────────────────────────────────────────────

impl IntlEngine {
    /// Look up a key in current locale then fallback. Does NOT track missing.
    fn lookup_key(&self, key: &str) -> Option<String> {
        if let Some(catalog) = self.catalogs.get(&self.current_locale) {
            if let Some(value) = catalog.get(key) {
                return Some(value.clone());
            }
        }
        if !self.fallback_locale.is_empty() && self.fallback_locale != self.current_locale {
            if let Some(catalog) = self.catalogs.get(&self.fallback_locale) {
                if let Some(value) = catalog.get(key) {
                    return Some(value.clone());
                }
            }
        }
        None
    }
}

// ── Helpers — lightweight JSON parsing without serde ────────────────────────

/// Parse flat JSON {"key":"value","key2":"value2"} into key-value pairs.
/// Handles escaped quotes in values. No nested objects or arrays.
fn parse_flat_json(json: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let json = json.trim();
    if json.len() < 2 || !json.starts_with('{') || !json.ends_with('}') {
        return pairs;
    }

    let inner = &json[1..json.len() - 1];
    let mut chars = inner.chars().peekable();

    loop {
        // Skip whitespace and commas
        while chars.peek().map_or(false, |c| *c == ' ' || *c == ',' || *c == '\n' || *c == '\r' || *c == '\t') {
            chars.next();
        }

        if chars.peek().is_none() {
            break;
        }

        // Parse key
        if let Some(key) = parse_json_string(&mut chars) {
            // Skip colon and whitespace
            while chars.peek().map_or(false, |c| *c == ':' || *c == ' ') {
                chars.next();
            }
            // Parse value
            if let Some(value) = parse_json_string(&mut chars) {
                pairs.push((key, value));
            }
        } else {
            break;
        }
    }

    pairs
}

/// Parse a JSON string value (with quotes), handling escape sequences.
fn parse_json_string(chars: &mut std::iter::Peekable<std::str::Chars>) -> Option<String> {
    // Expect opening quote
    if chars.peek() != Some(&'"') {
        return None;
    }
    chars.next(); // consume "

    let mut result = String::new();
    loop {
        match chars.next() {
            Some('\\') => {
                match chars.next() {
                    Some('n') => result.push('\n'),
                    Some('r') => result.push('\r'),
                    Some('t') => result.push('\t'),
                    Some(c) => result.push(c),
                    None => break,
                }
            }
            Some('"') => return Some(result),
            Some(c) => result.push(c),
            None => break,
        }
    }

    Some(result)
}
