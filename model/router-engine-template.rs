// ============================================================================
// ROUTER ENGINE TEMPLATE — Rust/WASM Client-Side Router State Machine
// ============================================================================
//
// HOW TO USE THIS TEMPLATE:
//
// 1. COPY this file and rename it (e.g., router-engine.rs).
//
// 2. DEFINE YOUR ROUTES in `init_routes()`. This is the primary customization
//    point — it's called once from the constructor, similar to how form-engine
//    uses init_fields(). Each route has:
//      - An ID string (e.g., "home", "user-detail", "settings")
//      - A path pattern with segments: Static("users"), Param("id"), CatchAll
//      - Optional guard flag (requires two-phase navigation)
//      - Optional breadcrumb label and parent route for breadcrumb trails
//
// 3. THE PATTERN:
//    - JS calls navigate("/users/42") or navigate("/settings")
//    - Rust matches the path against registered routes (linear scan)
//    - If the matched route has a guard, Rust returns "guard:routeId" instead
//      of completing the navigation. JS runs its async guard logic, then calls
//      resolve_guard(route_id, true/false) to allow or deny.
//    - On successful navigation, params and query_params are populated,
//      history is updated, and data_version bumps.
//    - JS reads current_path, current_route_id, param("id"), etc.
//
// 4. TWO-PHASE GUARD PROTOCOL:
//    Phase 1: navigate() detects a guarded route → returns "guard:<routeId>"
//             and sets pending_guard = Some(routeId).
//    Phase 2: JS does async work (auth check, unsaved-changes prompt, etc.)
//             then calls resolve_guard(routeId, allowed).
//             If allowed → completes the navigation.
//             If denied → clears pending state, stays on current route.
//
// 5. ROUTE MATCHING:
//    Routes are matched in registration order (first match wins).
//    - Static("users") matches the literal segment "users"
//    - Param("id") matches any single segment and captures it
//    - CatchAll matches all remaining segments (must be last)
//    Put more specific routes before general ones.
//
// 6. HISTORY:
//    A simple stack with a cursor (history_index). push_history() appends
//    and truncates forward history. go_back/go_forward move the cursor.
//    This is internal state — the browser's History API is managed by JS.
//
// 7. BREADCRUMBS:
//    Routes can declare a breadcrumb_label and parent_route_id. Calling
//    breadcrumbs_json() walks the parent chain from the current route and
//    returns a JSON array of [{id, label, path}] entries.
//
// ============================================================================

use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ── Route definition types (not exposed to WASM) ──────────────────────────

/// A single segment in a route pattern.
#[derive(Clone, Debug)]
enum Segment {
    /// Matches a literal path segment, e.g., "users".
    Static(String),
    /// Matches any single segment and captures it by name, e.g., ":id".
    Param(String),
    /// Matches all remaining segments. Must be the last segment.
    CatchAll,
}

/// A registered route entry.
#[derive(Clone, Debug)]
struct RouteEntry {
    id: String,
    segments: Vec<Segment>,
    guarded: bool,
    breadcrumb_label: String,
    parent_route_id: String,
}

/// A breadcrumb entry for JSON serialization.
#[derive(Clone, Debug)]
struct BreadcrumbEntry {
    id: String,
    label: String,
    path: String,
}

// ── RouterEngine ───────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct RouterEngine {
    current_path: String,
    current_route_id: String,
    params: Vec<(String, String)>,
    query_params: Vec<(String, String)>,
    history: Vec<String>,
    history_index: i32,
    pending_guard: Option<String>,
    pending_path: Option<String>,
    pending_params: Option<Vec<(String, String)>>,
    pending_query: Option<Vec<(String, String)>>,
    guard_results: HashMap<String, bool>,
    routes: Vec<RouteEntry>,
    data_version: u32,
}

#[wasm_bindgen]
impl RouterEngine {
    // ── Constructor ────────────────────────────────────────────────────

    #[wasm_bindgen(constructor)]
    pub fn new() -> RouterEngine {
        let mut engine = RouterEngine {
            current_path: String::from("/"),
            current_route_id: String::new(),
            params: Vec::new(),
            query_params: Vec::new(),
            history: vec![String::from("/")],
            history_index: 0,
            pending_guard: None,
            pending_path: None,
            pending_params: None,
            pending_query: None,
            guard_results: HashMap::new(),
            routes: Vec::new(),
            data_version: 0,
        };
        engine.init_routes();
        engine
    }

    // ── CUSTOMIZATION POINT — Define your routes here ──────────────────

    /// Register all application routes. This is the primary customization
    /// point — add your routes here. Called once from the constructor.
    ///
    /// Example:
    /// ```rust
    /// self.add_route("home", &[Static("".into())], false, "Home", "");
    /// self.add_route("users", &[Static("users".into())], false, "Users", "home");
    /// self.add_route("user-detail", &[Static("users".into()), Param("id".into())], false, "User", "users");
    /// self.add_route("settings", &[Static("settings".into())], true, "Settings", "home"); // guarded
    /// ```
    fn init_routes(&mut self) {
        // ── ADD YOUR ROUTES BELOW ──────────────────────────────────────
        //
        // self.add_route("home",
        //     vec![Segment::Static("".into())],
        //     false, "Home", "");
        //
        // self.add_route("users",
        //     vec![Segment::Static("users".into())],
        //     false, "Users", "home");
        //
        // self.add_route("user-detail",
        //     vec![Segment::Static("users".into()), Segment::Param("id".into())],
        //     false, "User Detail", "users");
        //
        // self.add_route("settings",
        //     vec![Segment::Static("settings".into())],
        //     true,   // ← guarded: JS must approve navigation
        //     "Settings", "home");
        //
        // self.add_route("catch-all",
        //     vec![Segment::CatchAll],
        //     false, "Not Found", "");
        //
        // ── END ROUTES ─────────────────────────────────────────────────
    }

    // ── Version tracking ───────────────────────────────────────────────

    #[wasm_bindgen(getter)]
    pub fn data_version(&self) -> u32 {
        self.data_version
    }

    fn bump_version(&mut self) {
        self.data_version = self.data_version.wrapping_add(1);
    }

    // ── Navigation ─────────────────────────────────────────────────────

    /// Navigate to a path. Returns:
    /// - "ok" if navigation completed successfully
    /// - "guard:<routeId>" if the route requires a guard check (two-phase)
    /// - "not-found" if no route matches
    /// - "blocked" if another guard is already pending
    ///
    /// The path can include a query string: "/users?page=2&sort=name"
    #[wasm_bindgen]
    pub fn navigate(&mut self, full_path: &str) -> String {
        // Block if a guard is already pending
        if self.pending_guard.is_some() {
            return "blocked".to_string();
        }

        // Split path and query
        let (path, query_string) = match full_path.find('?') {
            Some(idx) => (&full_path[..idx], &full_path[idx + 1..]),
            None => (full_path, ""),
        };

        // Parse query params
        let query_params = Self::parse_query_string(query_string);

        // Match against routes
        match self.match_route(path) {
            Some((route_id, params, guarded)) => {
                if guarded {
                    // Phase 1: stash pending state, return guard signal
                    self.pending_guard = Some(route_id.clone());
                    self.pending_path = Some(path.to_string());
                    self.pending_params = Some(params);
                    self.pending_query = Some(query_params);
                    self.bump_version();
                    format!("guard:{}", route_id)
                } else {
                    // Immediate navigation
                    self.apply_navigation(path, &route_id, params, query_params);
                    "ok".to_string()
                }
            }
            None => "not-found".to_string(),
        }
    }

    /// Phase 2 of guarded navigation. JS calls this after running its
    /// async guard logic.
    /// - `route_id` must match the pending guard.
    /// - `allowed`: true to complete navigation, false to cancel.
    /// Returns "ok", "denied", or "invalid" (wrong route_id).
    #[wasm_bindgen]
    pub fn resolve_guard(&mut self, route_id: &str, allowed: bool) -> String {
        let pending = match &self.pending_guard {
            Some(id) if id == route_id => id.clone(),
            _ => return "invalid".to_string(),
        };

        self.guard_results.insert(pending.clone(), allowed);

        if allowed {
            // Complete the stashed navigation
            let path = self.pending_path.take().unwrap_or_default();
            let params = self.pending_params.take().unwrap_or_default();
            let query = self.pending_query.take().unwrap_or_default();
            self.pending_guard = None;
            self.apply_navigation(&path, &pending, params, query);
            "ok".to_string()
        } else {
            // Cancel — clear pending state
            self.pending_guard = None;
            self.pending_path = None;
            self.pending_params = None;
            self.pending_query = None;
            self.bump_version();
            "denied".to_string()
        }
    }

    /// Check if a guard is currently pending.
    #[wasm_bindgen(getter)]
    pub fn has_pending_guard(&self) -> bool {
        self.pending_guard.is_some()
    }

    /// Get the route ID of the pending guard, if any.
    #[wasm_bindgen(getter)]
    pub fn pending_guard_route(&self) -> String {
        self.pending_guard.clone().unwrap_or_default()
    }

    // ── Current state getters ──────────────────────────────────────────

    #[wasm_bindgen(getter)]
    pub fn current_path(&self) -> String {
        self.current_path.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn current_route_id(&self) -> String {
        self.current_route_id.clone()
    }

    /// Get a captured route param by name (e.g., "id" from "/users/:id").
    /// Returns empty string if not found.
    #[wasm_bindgen]
    pub fn param(&self, name: &str) -> String {
        self.params
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    }

    /// Get a query param by name. Returns empty string if not found.
    #[wasm_bindgen]
    pub fn query_param(&self, name: &str) -> String {
        self.query_params
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    }

    /// Return all params as JSON: {"id":"42","tab":"settings"}
    #[wasm_bindgen]
    pub fn params_json(&self) -> String {
        Self::kv_vec_to_json(&self.params)
    }

    /// Return all query params as JSON.
    #[wasm_bindgen]
    pub fn query_params_json(&self) -> String {
        Self::kv_vec_to_json(&self.query_params)
    }

    /// Return the number of captured params.
    #[wasm_bindgen]
    pub fn param_count(&self) -> usize {
        self.params.len()
    }

    // ── History ────────────────────────────────────────────────────────

    /// Go back in history. Returns the new path, or empty string if at start.
    #[wasm_bindgen]
    pub fn go_back(&mut self) -> String {
        if self.history_index > 0 {
            self.history_index -= 1;
            let path = self.history[self.history_index as usize].clone();
            // Re-match and apply without pushing to history
            if let Some((route_id, params, _)) = self.match_route(&path) {
                self.current_path = path.clone();
                self.current_route_id = route_id;
                self.params = params;
                self.bump_version();
            }
            path
        } else {
            String::new()
        }
    }

    /// Go forward in history. Returns the new path, or empty string if at end.
    #[wasm_bindgen]
    pub fn go_forward(&mut self) -> String {
        if (self.history_index as usize) < self.history.len() - 1 {
            self.history_index += 1;
            let path = self.history[self.history_index as usize].clone();
            if let Some((route_id, params, _)) = self.match_route(&path) {
                self.current_path = path.clone();
                self.current_route_id = route_id;
                self.params = params;
                self.bump_version();
            }
            path
        } else {
            String::new()
        }
    }

    /// Check if back navigation is possible.
    #[wasm_bindgen]
    pub fn can_go_back(&self) -> bool {
        self.history_index > 0
    }

    /// Check if forward navigation is possible.
    #[wasm_bindgen]
    pub fn can_go_forward(&self) -> bool {
        (self.history_index as usize) < self.history.len() - 1
    }

    /// Return the history length.
    #[wasm_bindgen]
    pub fn history_length(&self) -> usize {
        self.history.len()
    }

    // ── Breadcrumbs ────────────────────────────────────────────────────

    /// Walk the parent chain from the current route and return a JSON
    /// array of breadcrumb entries: [{"id":"home","label":"Home","path":"/"},...]
    #[wasm_bindgen]
    pub fn breadcrumbs_json(&self) -> String {
        let mut crumbs: Vec<BreadcrumbEntry> = Vec::new();
        let mut current_id = self.current_route_id.clone();

        // Walk up the parent chain (max 20 to prevent infinite loops)
        for _ in 0..20 {
            if current_id.is_empty() {
                break;
            }
            if let Some(route) = self.routes.iter().find(|r| r.id == current_id) {
                crumbs.push(BreadcrumbEntry {
                    id: route.id.clone(),
                    label: if route.breadcrumb_label.is_empty() {
                        route.id.clone()
                    } else {
                        route.breadcrumb_label.clone()
                    },
                    path: self.route_base_path(route),
                });
                current_id = route.parent_route_id.clone();
            } else {
                break;
            }
        }

        crumbs.reverse();

        // Build JSON manually
        let items: Vec<String> = crumbs
            .iter()
            .map(|c| {
                format!(
                    "{{\"id\":\"{}\",\"label\":\"{}\",\"path\":\"{}\"}}",
                    c.id, c.label, c.path
                )
            })
            .collect();
        format!("[{}]", items.join(","))
    }

    // ── Route info ─────────────────────────────────────────────────────

    /// Return the number of registered routes.
    #[wasm_bindgen]
    pub fn route_count(&self) -> usize {
        self.routes.len()
    }

    /// Check if a route ID exists.
    #[wasm_bindgen]
    pub fn has_route(&self, route_id: &str) -> bool {
        self.routes.iter().any(|r| r.id == route_id)
    }

    /// Return all route IDs as a JSON array.
    #[wasm_bindgen]
    pub fn route_ids_json(&self) -> String {
        let items: Vec<String> = self.routes.iter().map(|r| format!("\"{}\"", r.id)).collect();
        format!("[{}]", items.join(","))
    }
}

// ── Private implementation ─────────────────────────────────────────────────

impl RouterEngine {
    /// Register a route. Called from init_routes().
    fn add_route(
        &mut self,
        id: impl Into<String>,
        segments: Vec<Segment>,
        guarded: bool,
        breadcrumb_label: impl Into<String>,
        parent_route_id: impl Into<String>,
    ) {
        self.routes.push(RouteEntry {
            id: id.into(),
            segments,
            guarded,
            breadcrumb_label: breadcrumb_label.into(),
            parent_route_id: parent_route_id.into(),
        });
    }

    /// Match a path against registered routes. Returns (route_id, params, guarded)
    /// for the first matching route, or None.
    fn match_route(&self, path: &str) -> Option<(String, Vec<(String, String)>, bool)> {
        let path_segments: Vec<&str> = path
            .trim_start_matches('/')
            .split('/')
            .filter(|s| !s.is_empty())
            .collect();

        // Special case: root path "/" with no segments
        let path_segments = if path == "/" || path.is_empty() {
            vec![]
        } else {
            path_segments
        };

        for route in &self.routes {
            if let Some(params) = Self::try_match(&route.segments, &path_segments) {
                return Some((route.id.clone(), params, route.guarded));
            }
        }
        None
    }

    /// Try to match path segments against route segments.
    /// Returns captured params on success, None on failure.
    fn try_match(
        route_segments: &[Segment],
        path_segments: &[&str],
    ) -> Option<Vec<(String, String)>> {
        let mut params = Vec::new();
        let mut path_idx = 0;

        for (seg_idx, segment) in route_segments.iter().enumerate() {
            match segment {
                Segment::Static(expected) => {
                    // Root route: Static("") matches empty path
                    if expected.is_empty() {
                        if path_segments.is_empty() && seg_idx == route_segments.len() - 1 {
                            return Some(params);
                        }
                        continue;
                    }
                    if path_idx >= path_segments.len() {
                        return None;
                    }
                    if path_segments[path_idx] != expected.as_str() {
                        return None;
                    }
                    path_idx += 1;
                }
                Segment::Param(name) => {
                    if path_idx >= path_segments.len() {
                        return None;
                    }
                    params.push((name.clone(), path_segments[path_idx].to_string()));
                    path_idx += 1;
                }
                Segment::CatchAll => {
                    // Matches everything remaining
                    let rest = path_segments[path_idx..].join("/");
                    params.push(("*".to_string(), rest));
                    return Some(params);
                }
            }
        }

        // All route segments consumed — path segments must also be consumed
        if path_idx == path_segments.len() {
            Some(params)
        } else {
            None
        }
    }

    /// Apply a successful navigation: update current state and history.
    fn apply_navigation(
        &mut self,
        path: &str,
        route_id: &str,
        params: Vec<(String, String)>,
        query_params: Vec<(String, String)>,
    ) {
        self.current_path = path.to_string();
        self.current_route_id = route_id.to_string();
        self.params = params;
        self.query_params = query_params;
        self.push_history(path);
        self.bump_version();
    }

    /// Push a path onto the history stack, truncating any forward history.
    fn push_history(&mut self, path: &str) {
        // Truncate forward history
        let new_len = (self.history_index + 1) as usize;
        self.history.truncate(new_len);
        self.history.push(path.to_string());
        self.history_index = (self.history.len() - 1) as i32;
    }

    /// Parse a query string "key=val&key2=val2" into key-value pairs.
    fn parse_query_string(qs: &str) -> Vec<(String, String)> {
        if qs.is_empty() {
            return Vec::new();
        }
        qs.split('&')
            .filter(|pair| !pair.is_empty())
            .map(|pair| {
                match pair.find('=') {
                    Some(idx) => (pair[..idx].to_string(), pair[idx + 1..].to_string()),
                    None => (pair.to_string(), String::new()),
                }
            })
            .collect()
    }

    /// Convert a Vec of (key, value) to JSON object string.
    fn kv_vec_to_json(pairs: &[(String, String)]) -> String {
        let items: Vec<String> = pairs
            .iter()
            .map(|(k, v)| format!("\"{}\":\"{}\"", k, v))
            .collect();
        format!("{{{}}}", items.join(","))
    }

    /// Build the base path for a route (substituting static segments only).
    /// Param segments are omitted since we don't know their values in the
    /// breadcrumb context.
    fn route_base_path(&self, route: &RouteEntry) -> String {
        let mut parts = Vec::new();
        for segment in &route.segments {
            match segment {
                Segment::Static(s) => {
                    if !s.is_empty() {
                        parts.push(s.as_str());
                    }
                }
                Segment::Param(name) => {
                    // Try to use the current param value if this is the active route
                    let value = self
                        .params
                        .iter()
                        .find(|(k, _)| k == name)
                        .map(|(_, v)| v.as_str())
                        .unwrap_or(":");
                    parts.push(value);
                }
                Segment::CatchAll => {
                    parts.push("*");
                }
            }
        }
        if parts.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", parts.join("/"))
        }
    }
}
