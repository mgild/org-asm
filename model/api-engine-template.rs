// ============================================================================
// API ENGINE TEMPLATE — Rust/WASM One-Platform Request Normalization
// ============================================================================
//
// HOW TO USE THIS TEMPLATE:
//
// 1. COPY this file and rename it (e.g., api-engine.rs).
//
// 2. DEFINE YOUR ENDPOINTS in `init_endpoints()`. This is the primary
//    customization point — called once from the constructor.
//
// 3. THE PATTERN:
//    - JS calls register_endpoint("get-users", "GET", "/api/users/:id", params)
//    - JS calls build_url("get-users", '{"id":"42","page":"1"}')
//      → returns "/api/users/42?page=1" (path params substituted, query appended)
//    - JS calls build_body("create-user", '{"name":"Alice","role":"admin"}')
//      → returns '{"name":"Alice"}' (only body-sourced params)
//    - JS calls begin_request("get-users", params) → gets request_id
//    - JS does the actual fetch, then calls set_request_success/error
//    - JS reads response_json(request_id) to get the response
//
// 4. ONE-PLATFORM PARAM NORMALIZATION:
//    Each endpoint param has a "source": query, body, path, or header.
//    The caller passes ONE params object; the engine splits by source:
//    - build_url() substitutes :param in path + appends query params
//    - build_body() extracts body-sourced params as JSON
//    This eliminates caller complexity around param placement.
//
// 5. RESPONSE FORMATS:
//    Each endpoint can be set to Json (0) or FlatBuffer (1).
//    FlatBuffer responses are stored as raw bytes with ptr/len accessors
//    for zero-copy access from JS.
//
// 6. CACHING:
//    Per-endpoint TTL-based cache. Cache keys are endpoint_id + params_json.
//    is_cached() checks if a valid cache entry exists.
//    cached_response() returns the cached response.
//    invalidate_cache() clears cache for one endpoint.
//
// ============================================================================

use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ── Internal types ─────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct ParamDef {
    name: String,
    source: u8, // 0=query, 1=body, 2=path, 3=header
    required: bool,
}

#[derive(Clone, Debug)]
struct EndpointEntry {
    id: String,
    method: String,
    path: String,
    params: Vec<ParamDef>,
    format: u8, // 0=json, 1=flatbuffer
    cache_ttl_ms: u64,
}

#[derive(Clone, Debug)]
struct RequestEntry {
    id: u32,
    endpoint_id: String,
    status: u8, // 0=idle, 1=loading, 2=success, 3=error, 4=cancelled
    response_json: String,
    response_bytes: Vec<u8>,
    error: String,
}

#[derive(Clone, Debug)]
struct CacheEntry {
    response: String,
    expires_at: f64, // ms since epoch
}

// ── ApiEngine ──────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct ApiEngine {
    endpoints: Vec<EndpointEntry>,
    endpoint_index: HashMap<String, usize>,
    requests: Vec<RequestEntry>,
    next_request_id: u32,
    cache: HashMap<String, CacheEntry>,
    data_version: u32,
}

#[wasm_bindgen]
impl ApiEngine {
    // ── Constructor ────────────────────────────────────────────────────

    #[wasm_bindgen(constructor)]
    pub fn new() -> ApiEngine {
        let mut engine = ApiEngine {
            endpoints: Vec::new(),
            endpoint_index: HashMap::new(),
            requests: Vec::new(),
            next_request_id: 1,
            cache: HashMap::new(),
            data_version: 0,
        };
        engine.init_endpoints();
        engine
    }

    // ── CUSTOMIZATION POINT ────────────────────────────────────────────

    /// Define your API endpoints here. Called once from the constructor.
    ///
    /// Example:
    /// ```rust
    /// self.register_endpoint(
    ///     "get-users", "GET", "/api/users",
    ///     r#"[{"name":"page","source":0,"required":false},{"name":"limit","source":0,"required":false}]"#
    /// );
    /// self.register_endpoint(
    ///     "get-user", "GET", "/api/users/:id",
    ///     r#"[{"name":"id","source":2,"required":true}]"#
    /// );
    /// self.register_endpoint(
    ///     "create-user", "POST", "/api/users",
    ///     r#"[{"name":"name","source":1,"required":true},{"name":"email","source":1,"required":true}]"#
    /// );
    /// ```
    fn init_endpoints(&mut self) {
        // ── ADD YOUR ENDPOINTS BELOW ───────────────────────────────────
        //
        // ── END ENDPOINTS ──────────────────────────────────────────────
    }

    // ── Version tracking ───────────────────────────────────────────────

    pub fn data_version(&self) -> u32 {
        self.data_version
    }

    fn bump_version(&mut self) {
        self.data_version = self.data_version.wrapping_add(1);
    }

    // ── Endpoints ──────────────────────────────────────────────────────

    /// Register an endpoint. params_json: [{"name":"x","source":0,"required":true},...]
    pub fn register_endpoint(&mut self, id: &str, method: &str, path: &str, params_json: &str) {
        let params = parse_param_defs(params_json);
        let idx = self.endpoints.len();
        self.endpoints.push(EndpointEntry {
            id: id.to_string(),
            method: method.to_string(),
            path: path.to_string(),
            params,
            format: 0,
            cache_ttl_ms: 0,
        });
        self.endpoint_index.insert(id.to_string(), idx);
        self.bump_version();
    }

    // ── Requests ───────────────────────────────────────────────────────

    /// Begin a request. Returns a request ID.
    pub fn begin_request(&mut self, endpoint_id: &str, _params_json: &str) -> u32 {
        let id = self.next_request_id;
        self.next_request_id += 1;
        self.requests.push(RequestEntry {
            id,
            endpoint_id: endpoint_id.to_string(),
            status: 0, // idle
            response_json: String::new(),
            response_bytes: Vec::new(),
            error: String::new(),
        });
        self.bump_version();
        id
    }

    /// Mark a request as loading.
    pub fn set_request_loading(&mut self, request_id: u32) {
        if let Some(req) = self.find_request_mut(request_id) {
            req.status = 1;
            self.bump_version();
        }
    }

    /// Mark a request as successful with response data.
    pub fn set_request_success(&mut self, request_id: u32, response_json: &str) {
        if let Some(req) = self.find_request_mut(request_id) {
            req.status = 2;
            req.response_json = response_json.to_string();
            req.error.clear();
            self.bump_version();
        }
    }

    /// Mark a request as failed with an error message.
    pub fn set_request_error(&mut self, request_id: u32, error: &str) {
        if let Some(req) = self.find_request_mut(request_id) {
            req.status = 3;
            req.error = error.to_string();
            self.bump_version();
        }
    }

    /// Cancel a request.
    pub fn cancel_request(&mut self, request_id: u32) {
        if let Some(req) = self.find_request_mut(request_id) {
            req.status = 4;
            self.bump_version();
        }
    }

    // ── Responses ──────────────────────────────────────────────────────

    /// Get the response JSON for a request.
    pub fn response_json(&self, request_id: u32) -> String {
        self.find_request(request_id)
            .map(|r| r.response_json.clone())
            .unwrap_or_default()
    }

    /// Get the response status for a request (0-4).
    pub fn response_status(&self, request_id: u32) -> u8 {
        self.find_request(request_id).map(|r| r.status).unwrap_or(0)
    }

    /// Get the response error for a request.
    pub fn response_error(&self, request_id: u32) -> String {
        self.find_request(request_id)
            .map(|r| r.error.clone())
            .unwrap_or_default()
    }

    // ── Format ─────────────────────────────────────────────────────────

    /// Set the response format for an endpoint (0=json, 1=flatbuffer).
    pub fn set_format(&mut self, endpoint_id: &str, format: u8) {
        if let Some(&idx) = self.endpoint_index.get(endpoint_id) {
            self.endpoints[idx].format = format;
            self.bump_version();
        }
    }

    /// Get the response format for an endpoint.
    pub fn endpoint_format(&self, endpoint_id: &str) -> u8 {
        self.endpoint_index
            .get(endpoint_id)
            .and_then(|&idx| self.endpoints.get(idx))
            .map(|e| e.format)
            .unwrap_or(0)
    }

    // ── FlatBuffer zero-copy ───────────────────────────────────────────

    /// Get the pointer to FlatBuffer response data.
    pub fn response_ptr(&self, request_id: u32) -> u32 {
        self.find_request(request_id)
            .map(|r| r.response_bytes.as_ptr() as u32)
            .unwrap_or(0)
    }

    /// Get the length of FlatBuffer response data.
    pub fn response_len(&self, request_id: u32) -> u32 {
        self.find_request(request_id)
            .map(|r| r.response_bytes.len() as u32)
            .unwrap_or(0)
    }

    // ── Param normalization ────────────────────────────────────────────

    /// Build URL with path param substitution + query params.
    /// Substitutes :param in path, appends query-sourced params.
    pub fn build_url(&self, endpoint_id: &str, params_json: &str) -> String {
        let endpoint = match self.find_endpoint(endpoint_id) {
            Some(e) => e,
            None => return String::new(),
        };

        let params = parse_flat_json(params_json);
        let mut url = endpoint.path.clone();

        // Substitute path params (:param → value)
        for param_def in &endpoint.params {
            if param_def.source == 2 {
                // path
                if let Some(value) = params.iter().find(|(k, _)| k == &param_def.name) {
                    let placeholder = format!(":{}", param_def.name);
                    url = url.replace(&placeholder, &value.1);
                }
            }
        }

        // Append query params
        let mut query_parts: Vec<String> = Vec::new();
        for param_def in &endpoint.params {
            if param_def.source == 0 {
                // query
                if let Some(value) = params.iter().find(|(k, _)| k == &param_def.name) {
                    query_parts.push(format!("{}={}", param_def.name, value.1));
                }
            }
        }

        if !query_parts.is_empty() {
            url.push('?');
            url.push_str(&query_parts.join("&"));
        }

        url
    }

    /// Build request body from body-sourced params.
    pub fn build_body(&self, endpoint_id: &str, params_json: &str) -> String {
        let endpoint = match self.find_endpoint(endpoint_id) {
            Some(e) => e,
            None => return String::from("{}"),
        };

        let params = parse_flat_json(params_json);
        let mut body_parts: Vec<String> = Vec::new();

        for param_def in &endpoint.params {
            if param_def.source == 1 {
                // body
                if let Some(value) = params.iter().find(|(k, _)| k == &param_def.name) {
                    body_parts.push(format!("\"{}\":\"{}\"", param_def.name, value.1));
                }
            }
        }

        format!("{{{}}}", body_parts.join(","))
    }

    // ── Cache ──────────────────────────────────────────────────────────

    /// Set cache TTL for an endpoint in milliseconds (0 = no caching).
    pub fn set_cache_ttl(&mut self, endpoint_id: &str, ttl_ms: u64) {
        if let Some(&idx) = self.endpoint_index.get(endpoint_id) {
            self.endpoints[idx].cache_ttl_ms = ttl_ms;
            self.bump_version();
        }
    }

    /// Whether a cached response exists for the given endpoint + params.
    /// Note: JS should pass Date.now() for time comparison via a wrapper,
    /// or we use a simple "exists" check without expiry for the template.
    pub fn is_cached(&self, endpoint_id: &str, params_json: &str) -> bool {
        let key = format!("{}:{}", endpoint_id, params_json);
        self.cache.contains_key(&key)
    }

    /// Get a cached response.
    pub fn cached_response(&self, endpoint_id: &str, params_json: &str) -> String {
        let key = format!("{}:{}", endpoint_id, params_json);
        self.cache
            .get(&key)
            .map(|e| e.response.clone())
            .unwrap_or_default()
    }

    /// Invalidate cache for a specific endpoint.
    pub fn invalidate_cache(&mut self, endpoint_id: &str) {
        let prefix = format!("{}:", endpoint_id);
        self.cache.retain(|k, _| !k.starts_with(&prefix));
        self.bump_version();
    }

    /// Invalidate all cached responses.
    pub fn invalidate_all_cache(&mut self) {
        self.cache.clear();
        self.bump_version();
    }

    // ── Info ───────────────────────────────────────────────────────────

    /// Number of active (non-completed) requests.
    pub fn active_request_count(&self) -> usize {
        self.requests
            .iter()
            .filter(|r| r.status == 0 || r.status == 1)
            .count()
    }

    /// Get the state of a request as u8 (0=idle,1=loading,2=success,3=error,4=cancelled).
    pub fn request_state(&self, request_id: u32) -> u8 {
        self.find_request(request_id).map(|r| r.status).unwrap_or(0)
    }

    /// Number of registered endpoints.
    pub fn endpoint_count(&self) -> usize {
        self.endpoints.len()
    }

    /// Get an endpoint ID by index.
    pub fn endpoint_id(&self, index: usize) -> String {
        self.endpoints
            .get(index)
            .map(|e| e.id.clone())
            .unwrap_or_default()
    }

    /// Get the HTTP method of an endpoint.
    pub fn endpoint_method(&self, id: &str) -> String {
        self.find_endpoint(id)
            .map(|e| e.method.clone())
            .unwrap_or_default()
    }

    /// Get the path pattern of an endpoint.
    pub fn endpoint_path(&self, id: &str) -> String {
        self.find_endpoint(id)
            .map(|e| e.path.clone())
            .unwrap_or_default()
    }

    // ── Reset ──────────────────────────────────────────────────────────

    /// Reset all state to defaults, then re-run init_endpoints().
    pub fn reset(&mut self) {
        self.endpoints.clear();
        self.endpoint_index.clear();
        self.requests.clear();
        self.next_request_id = 1;
        self.cache.clear();
        self.bump_version();
        self.init_endpoints();
    }
}

// ── Private implementation ─────────────────────────────────────────────────

impl ApiEngine {
    fn find_request(&self, request_id: u32) -> Option<&RequestEntry> {
        self.requests.iter().find(|r| r.id == request_id)
    }

    fn find_request_mut(&mut self, request_id: u32) -> Option<&mut RequestEntry> {
        self.requests.iter_mut().find(|r| r.id == request_id)
    }

    fn find_endpoint(&self, id: &str) -> Option<&EndpointEntry> {
        self.endpoint_index
            .get(id)
            .and_then(|&idx| self.endpoints.get(idx))
    }
}

// ── Helpers — lightweight JSON parsing without serde ────────────────────────

/// Parse param definitions from JSON: [{"name":"x","source":0,"required":true},...]
fn parse_param_defs(json: &str) -> Vec<ParamDef> {
    let mut defs = Vec::new();
    let json = json.trim();
    if json.len() < 2 || !json.starts_with('[') || !json.ends_with(']') {
        return defs;
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
                    let name = extract_string_field(obj_str, "name");
                    let source = extract_number_field(obj_str, "source");
                    let required = extract_bool_field(obj_str, "required");
                    defs.push(ParamDef {
                        name,
                        source: source as u8,
                        required,
                    });
                }
            }
            _ => {}
        }
    }

    defs
}

/// Parse flat JSON {"key":"value",...} into key-value pairs.
fn parse_flat_json(json: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let json = json.trim();
    if json.len() < 2 || !json.starts_with('{') || !json.ends_with('}') {
        return pairs;
    }

    let inner = &json[1..json.len() - 1];
    let mut chars = inner.chars().peekable();

    loop {
        skip_ws_comma(&mut chars);
        if chars.peek().is_none() {
            break;
        }
        if let Some(key) = parse_json_string(&mut chars) {
            skip_colon_ws(&mut chars);
            if let Some(value) = parse_json_string(&mut chars) {
                pairs.push((key, value));
            }
        } else {
            break;
        }
    }

    pairs
}

fn extract_string_field(json: &str, field: &str) -> String {
    let needle = format!("\"{}\":\"", field);
    let start = match json.find(&needle) {
        Some(pos) => pos + needle.len(),
        None => return String::new(),
    };
    let rest = &json[start..];
    match rest.find('"') {
        Some(end) => rest[..end].to_string(),
        None => String::new(),
    }
}

fn extract_number_field(json: &str, field: &str) -> u64 {
    let needle = format!("\"{}\":", field);
    let start = match json.find(&needle) {
        Some(pos) => pos + needle.len(),
        None => return 0,
    };
    let rest = json[start..].trim_start();
    let mut num_str = String::new();
    for c in rest.chars() {
        if c.is_ascii_digit() {
            num_str.push(c);
        } else {
            break;
        }
    }
    num_str.parse().unwrap_or(0)
}

fn extract_bool_field(json: &str, field: &str) -> bool {
    let needle = format!("\"{}\":", field);
    let start = match json.find(&needle) {
        Some(pos) => pos + needle.len(),
        None => return false,
    };
    let rest = json[start..].trim_start();
    rest.starts_with("true")
}

fn parse_json_string(chars: &mut std::iter::Peekable<std::str::Chars>) -> Option<String> {
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

fn skip_ws_comma(chars: &mut std::iter::Peekable<std::str::Chars>) {
    while chars.peek().map_or(false, |c| matches!(c, ' ' | ',' | '\n' | '\r' | '\t')) {
        chars.next();
    }
}

fn skip_colon_ws(chars: &mut std::iter::Peekable<std::str::Chars>) {
    while chars.peek().map_or(false, |c| *c == ':' || *c == ' ') {
        chars.next();
    }
}
