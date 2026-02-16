// ============================================================================
// VALIDATION ENGINE TEMPLATE — Rust/WASM Schema-Based Validation State Machine
// ============================================================================
//
// HOW TO USE THIS TEMPLATE:
//
// 1. COPY this file and rename it (e.g., validation-engine.rs).
//
// 2. THE PATTERN:
//    - JS calls add_rule(id, type, params) to register validation rules
//    - JS calls add_schema(id), add_schema_field(schema, field, rules_json)
//    - JS calls validate_json(schema_id, data_json) — returns true/false
//    - Engine populates per-field errors from rule evaluation
//    - JS reads errors via field_error(schema, field, index)
//
// 3. RULE TYPES:
//    0=required, 1=min, 2=max, 3=minLength, 4=maxLength,
//    5=pattern, 6=email, 7=custom.
//
// 4. CROSS-FIELD RULES:
//    Compare two field values using an operator:
//    0=equal, 1=notEqual, 2=greaterThan, 3=lessThan, 4=custom.
//
// 5. ASYNC VALIDATION:
//    start_validation(schema, field, rule_id) returns an ID.
//    resolve_async_validation(id, is_valid, error) completes it.
//    Pending validations tracked in a HashMap.
//
// ============================================================================

use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ── Supporting types ────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct SchemaEntry {
    /// field_name -> list of rule_ids
    fields: HashMap<String, Vec<String>>,
}

#[derive(Clone, Debug)]
struct CrossFieldEntry {
    rule_type: u8,
    fields: Vec<String>,
    params: String,
}

#[derive(Clone, Debug)]
struct PendingEntry {
    schema_id: String,
    field: String,
    rule_id: String,
}

// ── ValidationEngine ────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct ValidationEngine {
    /// rule_id -> (rule_type, params_json)
    rules: HashMap<String, (u8, String)>,
    rule_ids: Vec<String>,
    schemas: HashMap<String, SchemaEntry>,
    schema_ids: Vec<String>,
    /// schema_id -> field -> list of error strings
    errors: HashMap<String, HashMap<String, Vec<String>>>,
    /// schema_id -> list of cross-field rules
    cross_field_rules: HashMap<String, Vec<CrossFieldEntry>>,
    pending_validations: HashMap<u32, PendingEntry>,
    next_validation_id: u32,
    data_version: u32,
}

#[wasm_bindgen]
impl ValidationEngine {
    // ── Constructor ────────────────────────────────────────────────────

    #[wasm_bindgen(constructor)]
    pub fn new() -> ValidationEngine {
        ValidationEngine {
            rules: HashMap::new(),
            rule_ids: Vec::new(),
            schemas: HashMap::new(),
            schema_ids: Vec::new(),
            errors: HashMap::new(),
            cross_field_rules: HashMap::new(),
            pending_validations: HashMap::new(),
            next_validation_id: 1,
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

    // ── Rules ──────────────────────────────────────────────────────────

    /// Add a validation rule.
    /// rule_type: 0=required, 1=min, 2=max, 3=minLength, 4=maxLength,
    ///            5=pattern, 6=email, 7=custom.
    pub fn add_rule(&mut self, rule_id: &str, rule_type: u8, params_json: &str) {
        let id = rule_id.to_string();
        if !self.rules.contains_key(&id) {
            self.rule_ids.push(id.clone());
        }
        self.rules.insert(id, (rule_type, params_json.to_string()));
        self.bump_version();
    }

    /// Remove a validation rule by ID.
    pub fn remove_rule(&mut self, rule_id: &str) {
        if self.rules.remove(rule_id).is_some() {
            self.rule_ids.retain(|id| id != rule_id);
            self.bump_version();
        }
    }

    /// Number of registered rules.
    pub fn rule_count(&self) -> usize {
        self.rules.len()
    }

    /// Get a rule ID by index.
    pub fn rule_id(&self, index: usize) -> String {
        self.rule_ids.get(index).cloned().unwrap_or_default()
    }

    // ── Schemas ────────────────────────────────────────────────────────

    /// Add a validation schema.
    pub fn add_schema(&mut self, schema_id: &str) {
        let id = schema_id.to_string();
        if !self.schemas.contains_key(&id) {
            self.schema_ids.push(id.clone());
            self.schemas.insert(id, SchemaEntry {
                fields: HashMap::new(),
            });
        }
        self.bump_version();
    }

    /// Add a field to a schema with validation rules JSON (array of rule IDs).
    pub fn add_schema_field(&mut self, schema_id: &str, field: &str, rules_json: &str) {
        if let Some(schema) = self.schemas.get_mut(schema_id) {
            let rule_ids = parse_json_string_array(rules_json);
            schema.fields.insert(field.to_string(), rule_ids);
            self.bump_version();
        }
    }

    /// Remove a schema.
    pub fn remove_schema(&mut self, schema_id: &str) {
        if self.schemas.remove(schema_id).is_some() {
            self.schema_ids.retain(|id| id != schema_id);
            self.errors.remove(schema_id);
            self.cross_field_rules.remove(schema_id);
            self.bump_version();
        }
    }

    /// Number of registered schemas.
    pub fn schema_count(&self) -> usize {
        self.schemas.len()
    }

    /// Get a schema ID by index.
    pub fn schema_id(&self, index: usize) -> String {
        self.schema_ids.get(index).cloned().unwrap_or_default()
    }

    // ── Validation ─────────────────────────────────────────────────────

    /// Validate data against a schema. Returns true if valid.
    /// data_json is a flat JSON object {"field":"value",...}.
    pub fn validate_json(&mut self, schema_id: &str, data_json: &str) -> bool {
        let data = parse_flat_object(data_json);
        let mut schema_errors: HashMap<String, Vec<String>> = HashMap::new();

        if let Some(schema) = self.schemas.get(schema_id) {
            // Per-field validation
            for (field, rule_ids) in &schema.fields {
                let value = data.get(field).map(|v| v.as_str()).unwrap_or("");
                let mut field_errors = Vec::new();

                for rule_id in rule_ids {
                    if let Some(&(rule_type, ref params_json)) = self.rules.get(rule_id) {
                        if let Some(err) = evaluate_rule(rule_type, params_json, field, value) {
                            field_errors.push(err);
                        }
                    }
                }

                if !field_errors.is_empty() {
                    schema_errors.insert(field.clone(), field_errors);
                }
            }

            // Cross-field validation
            if let Some(cf_rules) = self.cross_field_rules.get(schema_id) {
                for cf in cf_rules {
                    if cf.fields.len() >= 2 {
                        let val_a = data.get(&cf.fields[0]).map(|v| v.as_str()).unwrap_or("");
                        let val_b = data.get(&cf.fields[1]).map(|v| v.as_str()).unwrap_or("");

                        if let Some(err) = evaluate_cross_field(cf.rule_type, val_a, val_b, &cf.fields) {
                            let entry = schema_errors.entry(cf.fields[1].clone()).or_insert_with(Vec::new);
                            entry.push(err);
                        }
                    }
                }
            }
        }

        let is_valid = schema_errors.values().all(|errs| errs.is_empty());
        self.errors.insert(schema_id.to_string(), schema_errors);
        self.bump_version();
        is_valid
    }

    /// Clear all errors for a schema.
    pub fn clear_errors(&mut self, schema_id: &str) {
        self.errors.remove(schema_id);
        self.bump_version();
    }

    // ── Errors ─────────────────────────────────────────────────────────

    /// Total error count for a schema.
    pub fn error_count(&self, schema_id: &str) -> usize {
        self.errors
            .get(schema_id)
            .map(|fields| fields.values().map(|v| v.len()).sum())
            .unwrap_or(0)
    }

    /// Error count for a specific field in a schema.
    pub fn field_error_count(&self, schema_id: &str, field: &str) -> usize {
        self.errors
            .get(schema_id)
            .and_then(|fields| fields.get(field))
            .map(|errs| errs.len())
            .unwrap_or(0)
    }

    /// Get a specific error for a field by index.
    pub fn field_error(&self, schema_id: &str, field: &str, index: usize) -> String {
        self.errors
            .get(schema_id)
            .and_then(|fields| fields.get(field))
            .and_then(|errs| errs.get(index))
            .cloned()
            .unwrap_or_default()
    }

    /// Whether a field has any errors.
    pub fn field_has_error(&self, schema_id: &str, field: &str) -> bool {
        self.errors
            .get(schema_id)
            .and_then(|fields| fields.get(field))
            .map(|errs| !errs.is_empty())
            .unwrap_or(false)
    }

    /// Get all errors for a field as JSON array.
    pub fn field_errors_json(&self, schema_id: &str, field: &str) -> String {
        let errs = self.errors
            .get(schema_id)
            .and_then(|fields| fields.get(field));

        match errs {
            Some(errors) => {
                let mut json = String::from("[");
                for (i, err) in errors.iter().enumerate() {
                    if i > 0 {
                        json.push(',');
                    }
                    json.push('"');
                    // Escape quotes in error message
                    for c in err.chars() {
                        match c {
                            '"' => json.push_str("\\\""),
                            '\\' => json.push_str("\\\\"),
                            _ => json.push(c),
                        }
                    }
                    json.push('"');
                }
                json.push(']');
                json
            }
            None => "[]".to_string(),
        }
    }

    // ── Cross-field ────────────────────────────────────────────────────

    /// Add a cross-field rule.
    /// rule_type: 0=equal, 1=notEqual, 2=greaterThan, 3=lessThan, 4=custom.
    pub fn add_cross_field_rule(
        &mut self,
        schema_id: &str,
        rule_type: u8,
        fields_json: &str,
        params_json: &str,
    ) {
        let fields = parse_json_string_array(fields_json);
        let entry = CrossFieldEntry {
            rule_type,
            fields,
            params: params_json.to_string(),
        };
        self.cross_field_rules
            .entry(schema_id.to_string())
            .or_insert_with(Vec::new)
            .push(entry);
        self.bump_version();
    }

    /// Number of cross-field rules for a schema.
    pub fn cross_field_rule_count(&self, schema_id: &str) -> usize {
        self.cross_field_rules
            .get(schema_id)
            .map(|rules| rules.len())
            .unwrap_or(0)
    }

    // ── Async ──────────────────────────────────────────────────────────

    /// Start an async validation. Returns a validation ID.
    pub fn start_validation(&mut self, schema_id: &str, field: &str, rule_id: &str) -> u32 {
        let id = self.next_validation_id;
        self.next_validation_id = self.next_validation_id.wrapping_add(1);
        self.pending_validations.insert(
            id,
            PendingEntry {
                schema_id: schema_id.to_string(),
                field: field.to_string(),
                rule_id: rule_id.to_string(),
            },
        );
        self.bump_version();
        id
    }

    /// Resolve an async validation with result.
    pub fn resolve_async_validation(
        &mut self,
        validation_id: u32,
        is_valid: bool,
        error: &str,
    ) {
        if let Some(pending) = self.pending_validations.remove(&validation_id) {
            if !is_valid {
                let schema_errors = self.errors
                    .entry(pending.schema_id)
                    .or_insert_with(HashMap::new);
                let field_errors = schema_errors
                    .entry(pending.field)
                    .or_insert_with(Vec::new);
                field_errors.push(error.to_string());
            }
            self.bump_version();
        }
    }

    /// Number of pending async validations.
    pub fn pending_validation_count(&self) -> usize {
        self.pending_validations.len()
    }

    /// Get the schema ID for a pending validation.
    pub fn pending_validation_schema(&self, validation_id: u32) -> String {
        self.pending_validations
            .get(&validation_id)
            .map(|p| p.schema_id.clone())
            .unwrap_or_default()
    }

    /// Get the field for a pending validation.
    pub fn pending_validation_field(&self, validation_id: u32) -> String {
        self.pending_validations
            .get(&validation_id)
            .map(|p| p.field.clone())
            .unwrap_or_default()
    }

    // ── Reset ──────────────────────────────────────────────────────────

    /// Reset all state to defaults.
    pub fn reset(&mut self) {
        self.rules.clear();
        self.rule_ids.clear();
        self.schemas.clear();
        self.schema_ids.clear();
        self.errors.clear();
        self.cross_field_rules.clear();
        self.pending_validations.clear();
        self.next_validation_id = 1;
        self.bump_version();
    }
}

// ── Rule evaluation ─────────────────────────────────────────────────────────

/// Evaluate a single validation rule. Returns Some(error_message) if invalid.
fn evaluate_rule(rule_type: u8, params_json: &str, field: &str, value: &str) -> Option<String> {
    let params = parse_flat_object(params_json);

    match rule_type {
        0 => {
            // required — value must be non-empty
            if value.trim().is_empty() {
                Some(format!("{} is required", field))
            } else {
                None
            }
        }
        1 => {
            // min — numeric minimum
            let min_str = params.get("min").map(|v| v.as_str()).unwrap_or("0");
            if let (Ok(val), Ok(min)) = (value.parse::<f64>(), min_str.parse::<f64>()) {
                if val < min {
                    Some(format!("{} must be at least {}", field, min))
                } else {
                    None
                }
            } else {
                None
            }
        }
        2 => {
            // max — numeric maximum
            let max_str = params.get("max").map(|v| v.as_str()).unwrap_or("0");
            if let (Ok(val), Ok(max)) = (value.parse::<f64>(), max_str.parse::<f64>()) {
                if val > max {
                    Some(format!("{} must be at most {}", field, max))
                } else {
                    None
                }
            } else {
                None
            }
        }
        3 => {
            // minLength — string minimum length
            let min_str = params.get("min").map(|v| v.as_str()).unwrap_or("0");
            if let Ok(min) = min_str.parse::<usize>() {
                if value.len() < min {
                    Some(format!("{} must be at least {} characters", field, min))
                } else {
                    None
                }
            } else {
                None
            }
        }
        4 => {
            // maxLength — string maximum length
            let max_str = params.get("max").map(|v| v.as_str()).unwrap_or("0");
            if let Ok(max) = max_str.parse::<usize>() {
                if value.len() > max {
                    Some(format!("{} must be at most {} characters", field, max))
                } else {
                    None
                }
            } else {
                None
            }
        }
        5 => {
            // pattern — simple contains check
            let pattern = params.get("pattern").map(|v| v.as_str()).unwrap_or("");
            if !pattern.is_empty() && !value.contains(pattern) {
                Some(format!("{} does not match the required pattern", field))
            } else {
                None
            }
        }
        6 => {
            // email — must contain '@' and '.'
            if !value.contains('@') || !value.contains('.') {
                Some(format!("{} must be a valid email address", field))
            } else {
                None
            }
        }
        7 => {
            // custom — always valid (logic handled externally via async)
            None
        }
        _ => None,
    }
}

/// Evaluate a cross-field rule. Returns Some(error_message) if invalid.
fn evaluate_cross_field(
    rule_type: u8,
    val_a: &str,
    val_b: &str,
    fields: &[String],
) -> Option<String> {
    let field_a = fields.get(0).map(|s| s.as_str()).unwrap_or("field1");
    let field_b = fields.get(1).map(|s| s.as_str()).unwrap_or("field2");

    match rule_type {
        0 => {
            // equal — both fields must have the same value
            if val_a != val_b {
                Some(format!("{} must equal {}", field_b, field_a))
            } else {
                None
            }
        }
        1 => {
            // notEqual — fields must differ
            if val_a == val_b {
                Some(format!("{} must not equal {}", field_b, field_a))
            } else {
                None
            }
        }
        2 => {
            // greaterThan — field_b > field_a numerically
            match (val_a.parse::<f64>(), val_b.parse::<f64>()) {
                (Ok(a), Ok(b)) => {
                    if b <= a {
                        Some(format!("{} must be greater than {}", field_b, field_a))
                    } else {
                        None
                    }
                }
                _ => None,
            }
        }
        3 => {
            // lessThan — field_b < field_a numerically
            match (val_a.parse::<f64>(), val_b.parse::<f64>()) {
                (Ok(a), Ok(b)) => {
                    if b >= a {
                        Some(format!("{} must be less than {}", field_b, field_a))
                    } else {
                        None
                    }
                }
                _ => None,
            }
        }
        4 => {
            // custom — always valid (logic handled externally)
            None
        }
        _ => None,
    }
}

// ── Helpers — lightweight JSON parsing without serde ────────────────────────

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
