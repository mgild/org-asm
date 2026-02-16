// ============================================================================
// AUTH ENGINE TEMPLATE — Rust/WASM Authentication State Machine
// ============================================================================
//
// HOW TO USE THIS TEMPLATE:
//
// 1. COPY this file into your project and rename it (e.g., auth-engine.rs)
//
// 2. DEFINE your TypeScript interface (IAuthEngine) that matches the
//    #[wasm_bindgen] methods exported here. The JS side calls these methods
//    to read/write auth state; the Rust side owns the data.
//
// 3. THE PATTERN:
//    - JS calls set_tokens() after a successful login/refresh
//    - JS calls clear() on logout
//    - JS reads access_token(), is_access_expired(), etc. to decide what to do
//    - JS calls set_user_json() with the raw user profile JSON
//    - Rust parses out id, display_name, roles, permissions — no serde needed
//    - data_version increments on every mutation so JS can react to changes
//
// 4. TIMESTAMPS are f64 because JavaScript's Date.now() returns a float-safe
//    integer, and wasm_bindgen maps JS `number` to Rust `f64`. We compare
//    against a `now_ms: f64` parameter rather than calling system time from
//    WASM (which is not portable).
//
// 5. NO SERDE — we parse JSON with simple string scanning helpers. This keeps
//    the WASM binary small and avoids pulling in serde_json. The trade-off is
//    that we only support flat string fields and string arrays. If you need
//    deeply nested JSON parsing, add serde_json as a dependency instead.
//
// 6. PERMISSIONS & ROLES are stored as HashSet<String> for O(1) lookup.
//    JS passes them as JSON arrays: ["read","write","admin"].
//
// 7. CUSTOMIZATION POINTS:
//    - Add domain-specific auth status codes (the `auth_status` u8 field)
//    - Add extra fields to the struct for your use case (org_id, tenant, etc.)
//    - Extend parse_user_json() to extract additional fields from user JSON
//    - Add helper methods for permission checks (has_any_role, has_all_perms)
//
// ============================================================================

use std::collections::HashSet;
use wasm_bindgen::prelude::*;

// ── Helpers — lightweight JSON parsing without serde ────────────────────────

/// Extract a string value for a given key from a flat JSON object.
/// Looks for `"key":"value"` and returns the value (unescaped).
/// Returns None if the key is not found or the JSON is malformed.
fn extract_json_string(json: &str, key: &str) -> Option<String> {
    // Build the search needle: "key":"
    let needle = format!("\"{}\":\"", key);
    let start = json.find(&needle)?;
    let value_start = start + needle.len();
    let rest = &json[value_start..];

    // Find the closing quote, handling escaped quotes
    let mut chars = rest.chars();
    let mut result = String::new();
    loop {
        match chars.next() {
            Some('\\') => {
                // Escaped character — take the next char literally
                if let Some(c) = chars.next() {
                    result.push(c);
                }
            }
            Some('"') => break,
            Some(c) => result.push(c),
            None => return None, // Unterminated string
        }
    }
    Some(result)
}

/// Parse a JSON array of strings: `["a","b","c"]` → Vec<String>.
/// Returns an empty Vec on malformed input.
fn parse_json_string_array(json: &str) -> Vec<String> {
    let trimmed = json.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return Vec::new();
    }

    let inner = &trimmed[1..trimmed.len() - 1];
    if inner.trim().is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();
    let mut in_string = false;
    let mut escaped = false;
    let mut current = String::new();

    for ch in inner.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_string => {
                escaped = true;
            }
            '"' => {
                if in_string {
                    // End of string — collect it
                    results.push(current.clone());
                    current.clear();
                }
                in_string = !in_string;
            }
            _ if in_string => {
                current.push(ch);
            }
            _ => {
                // Outside string — skip commas, whitespace, etc.
            }
        }
    }

    results
}

/// Extract `id` and `name` (or `displayName`) from a user JSON blob.
fn parse_user_json(json: &str) -> (String, String) {
    let id = extract_json_string(json, "id").unwrap_or_default();
    let name = extract_json_string(json, "displayName")
        .or_else(|| extract_json_string(json, "display_name"))
        .or_else(|| extract_json_string(json, "name"))
        .unwrap_or_default();
    (id, name)
}

// ── Auth status constants ──────────────────────────────────────────────────

const AUTH_STATUS_NONE: u8 = 0;        // No auth attempted
const AUTH_STATUS_PENDING: u8 = 1;     // Login in progress
const AUTH_STATUS_AUTHENTICATED: u8 = 2; // Valid tokens present
const AUTH_STATUS_EXPIRED: u8 = 3;     // Tokens expired, refresh needed
const AUTH_STATUS_ERROR: u8 = 4;       // Auth error occurred
const AUTH_STATUS_LOGGED_OUT: u8 = 5;  // Explicitly logged out

// ── AuthEngine ─────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct AuthEngine {
    access_token: String,
    refresh_token: String,
    access_expiry_ms: f64,
    refresh_expiry_ms: f64,
    auth_status: u8,
    error_message: String,
    permissions: HashSet<String>,
    roles: HashSet<String>,
    user_json: String,
    user_id: String,
    user_display_name: String,
    data_version: u32,
}

#[wasm_bindgen]
impl AuthEngine {
    // ── Constructor ────────────────────────────────────────────────────

    #[wasm_bindgen(constructor)]
    pub fn new() -> AuthEngine {
        AuthEngine {
            access_token: String::new(),
            refresh_token: String::new(),
            access_expiry_ms: 0.0,
            refresh_expiry_ms: 0.0,
            auth_status: AUTH_STATUS_NONE,
            error_message: String::new(),
            permissions: HashSet::new(),
            roles: HashSet::new(),
            user_json: String::new(),
            user_id: String::new(),
            user_display_name: String::new(),
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

    // ── Token management ───────────────────────────────────────────────

    /// Set both tokens and their expiry times (in milliseconds since epoch).
    /// Called by JS after a successful login or token refresh.
    #[wasm_bindgen]
    pub fn set_tokens(
        &mut self,
        access_token: &str,
        refresh_token: &str,
        access_expiry_ms: f64,
        refresh_expiry_ms: f64,
    ) {
        self.access_token = access_token.to_string();
        self.refresh_token = refresh_token.to_string();
        self.access_expiry_ms = access_expiry_ms;
        self.refresh_expiry_ms = refresh_expiry_ms;
        self.auth_status = AUTH_STATUS_AUTHENTICATED;
        self.error_message.clear();
        self.bump_version();
    }

    /// Update only the access token (e.g., after a silent refresh).
    #[wasm_bindgen]
    pub fn set_access_token(&mut self, token: &str, expiry_ms: f64) {
        self.access_token = token.to_string();
        self.access_expiry_ms = expiry_ms;
        if self.auth_status == AUTH_STATUS_EXPIRED {
            self.auth_status = AUTH_STATUS_AUTHENTICATED;
        }
        self.error_message.clear();
        self.bump_version();
    }

    #[wasm_bindgen(getter)]
    pub fn access_token(&self) -> String {
        self.access_token.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn refresh_token(&self) -> String {
        self.refresh_token.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn access_expiry_ms(&self) -> f64 {
        self.access_expiry_ms
    }

    #[wasm_bindgen(getter)]
    pub fn refresh_expiry_ms(&self) -> f64 {
        self.refresh_expiry_ms
    }

    // ── Expiry checks ──────────────────────────────────────────────────

    /// Check if the access token is expired. Pass `now_ms` from JS
    /// (e.g., Date.now()) since WASM has no portable system clock.
    #[wasm_bindgen]
    pub fn is_access_expired(&self, now_ms: f64) -> bool {
        self.access_expiry_ms > 0.0 && now_ms >= self.access_expiry_ms
    }

    /// Check if the refresh token is expired.
    #[wasm_bindgen]
    pub fn is_refresh_expired(&self, now_ms: f64) -> bool {
        self.refresh_expiry_ms > 0.0 && now_ms >= self.refresh_expiry_ms
    }

    /// Returns true if the access token is present and not expired.
    #[wasm_bindgen]
    pub fn is_authenticated(&self, now_ms: f64) -> bool {
        !self.access_token.is_empty()
            && self.auth_status == AUTH_STATUS_AUTHENTICATED
            && !self.is_access_expired(now_ms)
    }

    /// Check if a refresh is needed (access expired but refresh still valid).
    #[wasm_bindgen]
    pub fn needs_refresh(&self, now_ms: f64) -> bool {
        self.is_access_expired(now_ms) && !self.is_refresh_expired(now_ms)
    }

    /// Milliseconds until the access token expires. Returns 0.0 if already expired.
    #[wasm_bindgen]
    pub fn access_ttl_ms(&self, now_ms: f64) -> f64 {
        let remaining = self.access_expiry_ms - now_ms;
        if remaining > 0.0 { remaining } else { 0.0 }
    }

    // ── Auth status ────────────────────────────────────────────────────

    #[wasm_bindgen(getter)]
    pub fn auth_status(&self) -> u8 {
        self.auth_status
    }

    #[wasm_bindgen]
    pub fn set_auth_status(&mut self, status: u8) {
        self.auth_status = status;
        self.bump_version();
    }

    #[wasm_bindgen]
    pub fn set_pending(&mut self) {
        self.auth_status = AUTH_STATUS_PENDING;
        self.error_message.clear();
        self.bump_version();
    }

    #[wasm_bindgen]
    pub fn set_error(&mut self, message: &str) {
        self.auth_status = AUTH_STATUS_ERROR;
        self.error_message = message.to_string();
        self.bump_version();
    }

    #[wasm_bindgen(getter)]
    pub fn error_message(&self) -> String {
        self.error_message.clone()
    }

    // ── User profile ───────────────────────────────────────────────────

    /// Set the raw user profile JSON. Automatically extracts id and display name.
    #[wasm_bindgen]
    pub fn set_user_json(&mut self, json: &str) {
        self.user_json = json.to_string();
        let (id, name) = parse_user_json(json);
        self.user_id = id;
        self.user_display_name = name;
        self.bump_version();
    }

    #[wasm_bindgen(getter)]
    pub fn user_json(&self) -> String {
        self.user_json.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn user_id(&self) -> String {
        self.user_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn user_display_name(&self) -> String {
        self.user_display_name.clone()
    }

    // ── Permissions ────────────────────────────────────────────────────

    /// Set permissions from a JSON array string, e.g., `["read","write","admin"]`.
    #[wasm_bindgen]
    pub fn set_permissions_json(&mut self, json: &str) {
        self.permissions.clear();
        for perm in parse_json_string_array(json) {
            self.permissions.insert(perm);
        }
        self.bump_version();
    }

    /// Check if a specific permission is present.
    #[wasm_bindgen]
    pub fn has_permission(&self, perm: &str) -> bool {
        self.permissions.contains(perm)
    }

    /// Return the number of permissions.
    #[wasm_bindgen]
    pub fn permission_count(&self) -> usize {
        self.permissions.len()
    }

    /// Return all permissions as a JSON array string.
    #[wasm_bindgen]
    pub fn permissions_json(&self) -> String {
        let items: Vec<String> = self
            .permissions
            .iter()
            .map(|p| format!("\"{}\"", p))
            .collect();
        format!("[{}]", items.join(","))
    }

    // ── Roles ──────────────────────────────────────────────────────────

    /// Set roles from a JSON array string, e.g., `["user","editor"]`.
    #[wasm_bindgen]
    pub fn set_roles_json(&mut self, json: &str) {
        self.roles.clear();
        for role in parse_json_string_array(json) {
            self.roles.insert(role);
        }
        self.bump_version();
    }

    /// Check if a specific role is present.
    #[wasm_bindgen]
    pub fn has_role(&self, role: &str) -> bool {
        self.roles.contains(role)
    }

    /// Return the number of roles.
    #[wasm_bindgen]
    pub fn role_count(&self) -> usize {
        self.roles.len()
    }

    /// Return all roles as a JSON array string.
    #[wasm_bindgen]
    pub fn roles_json(&self) -> String {
        let items: Vec<String> = self
            .roles
            .iter()
            .map(|r| format!("\"{}\"", r))
            .collect();
        format!("[{}]", items.join(","))
    }

    /// Check if the user has ANY of the given roles (comma-separated).
    #[wasm_bindgen]
    pub fn has_any_role(&self, roles_csv: &str) -> bool {
        roles_csv
            .split(',')
            .any(|r| self.roles.contains(r.trim()))
    }

    // ── Clear / Logout ─────────────────────────────────────────────────

    /// Full logout — clears all auth state.
    #[wasm_bindgen]
    pub fn clear(&mut self) {
        self.access_token.clear();
        self.refresh_token.clear();
        self.access_expiry_ms = 0.0;
        self.refresh_expiry_ms = 0.0;
        self.auth_status = AUTH_STATUS_LOGGED_OUT;
        self.error_message.clear();
        self.permissions.clear();
        self.roles.clear();
        self.user_json.clear();
        self.user_id.clear();
        self.user_display_name.clear();
        self.bump_version();
    }

    // ── Snapshot / Restore ─────────────────────────────────────────────

    /// Export the full auth state as a JSON string for persistence.
    /// Tokens are included — caller is responsible for secure storage.
    #[wasm_bindgen]
    pub fn snapshot_json(&self) -> String {
        format!(
            concat!(
                "{{",
                "\"accessToken\":\"{}\",",
                "\"refreshToken\":\"{}\",",
                "\"accessExpiryMs\":{},",
                "\"refreshExpiryMs\":{},",
                "\"authStatus\":{},",
                "\"errorMessage\":\"{}\",",
                "\"permissions\":{},",
                "\"roles\":{},",
                "\"userJson\":\"{}\",",
                "\"dataVersion\":{}",
                "}}"
            ),
            self.access_token,
            self.refresh_token,
            self.access_expiry_ms,
            self.refresh_expiry_ms,
            self.auth_status,
            self.error_message,
            self.permissions_json(),
            self.roles_json(),
            self.user_json.replace('\\', "\\\\").replace('"', "\\\""),
            self.data_version,
        )
    }

    /// Restore auth state from a previously exported JSON snapshot.
    #[wasm_bindgen]
    pub fn restore_snapshot(&mut self, json: &str) {
        if let Some(token) = extract_json_string(json, "accessToken") {
            self.access_token = token;
        }
        if let Some(token) = extract_json_string(json, "refreshToken") {
            self.refresh_token = token;
        }
        // Parse numeric fields manually
        if let Some(val) = Self::extract_json_number(json, "accessExpiryMs") {
            self.access_expiry_ms = val;
        }
        if let Some(val) = Self::extract_json_number(json, "refreshExpiryMs") {
            self.refresh_expiry_ms = val;
        }
        if let Some(val) = Self::extract_json_number(json, "authStatus") {
            self.auth_status = val as u8;
        }
        if let Some(msg) = extract_json_string(json, "errorMessage") {
            self.error_message = msg;
        }
        // Parse permissions and roles arrays
        if let Some(start) = json.find("\"permissions\":[") {
            let arr_start = start + "\"permissions\":".len();
            if let Some(end) = json[arr_start..].find(']') {
                let arr = &json[arr_start..arr_start + end + 1];
                self.permissions.clear();
                for item in parse_json_string_array(arr) {
                    self.permissions.insert(item);
                }
            }
        }
        if let Some(start) = json.find("\"roles\":[") {
            let arr_start = start + "\"roles\":".len();
            if let Some(end) = json[arr_start..].find(']') {
                let arr = &json[arr_start..arr_start + end + 1];
                self.roles.clear();
                for item in parse_json_string_array(arr) {
                    self.roles.insert(item);
                }
            }
        }
        // Re-parse user JSON if present
        if let Some(user) = extract_json_string(json, "userJson") {
            let (id, name) = parse_user_json(&user);
            self.user_id = id;
            self.user_display_name = name;
            self.user_json = user;
        }
        self.bump_version();
    }
}

// ── Private helpers (not exposed to WASM) ──────────────────────────────────

impl AuthEngine {
    /// Extract a numeric value for a given key from JSON.
    /// Looks for `"key":123.45` patterns.
    fn extract_json_number(json: &str, key: &str) -> Option<f64> {
        let needle = format!("\"{}\":", key);
        let start = json.find(&needle)?;
        let value_start = start + needle.len();
        let rest = json[value_start..].trim_start();

        let end = rest
            .find(|c: char| c == ',' || c == '}' || c == ']')
            .unwrap_or(rest.len());
        rest[..end].trim().parse::<f64>().ok()
    }
}
