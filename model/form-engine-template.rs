// =============================================================================
// Form Engine Template (HashMap-based)
// =============================================================================
//
// This template implements the IFormEngine contract using HashMaps for flexible
// field management. It provides:
//
//   - Per-field value storage with dirty tracking against initial values
//   - Per-field validation dispatched via match on field name
//   - Cross-field validation (e.g., password confirmation)
//   - Touch tracking (fields that have been blurred)
//   - Submit lifecycle (touch all -> validate all -> report validity)
//   - Reset to initial state
//   - A data_version counter bumped on every state mutation, so the TS side
//     can cheaply check "did anything change?" without deep-comparing values.
//
// HOW TO USE THIS TEMPLATE:
//
//   1. Copy this file into your model crate and rename the struct.
//   2. Fill in `init_fields()` with your actual field names and defaults.
//   3. Fill in `validate_field_internal()` with per-field validation logic.
//      The match arms dispatch to chainable validators from the shared crate:
//
//        "email" => validate(value).required().email().finish(),
//        "age"   => validate(value).required().positive_f64().finish(),
//
//   4. Fill in `validate_cross_fields()` for multi-field rules like
//      "password must match confirm_password".
//   5. Expose the #[wasm_bindgen] methods to TypeScript. The TS hooks call:
//        - set_field(name, value)  on every input change
//        - touch_field(name)       on blur
//        - field_error(name)       to render inline errors
//        - submit()                on form submit
//        - reset()                 on cancel / reset button
//        - data_version()          to trigger React re-renders
//
// HOW DIRTY TRACKING WORKS:
//
//   `initial_values` stores the default (or server-loaded) value for each field.
//   When `set_field` is called, we compare the new value to the initial value.
//   If they differ, the field is added to `dirty`. If they match again, it is
//   removed. `is_dirty()` returns true if ANY field differs from its initial.
//   `reset()` copies initial_values back into values and clears the dirty set.
//
// HOW VALIDATION DISPATCH WORKS:
//
//   `validate_field_internal(name, value)` uses a match on `name` to call the
//   appropriate chain of validators. If the match returns Ok(()), the field's
//   error entry is removed. If it returns Err(msg), the error is stored.
//   `validate_all()` iterates every field in `values` and calls
//   `validate_field_internal`, then calls `validate_cross_fields()` for rules
//   that span multiple fields.
//
// HOW TO INTEGRATE WITH TYPESCRIPT HOOKS:
//
//   The TypeScript useFormEngine hook should:
//     1. Hold a ref to the WASM FormEngine instance.
//     2. On mount, call new_form_engine() to create the instance.
//     3. Provide onChange(name, value) that calls engine.set_field(name, value).
//     4. Provide onBlur(name) that calls engine.touch_field(name).
//     5. Provide getError(name) that calls engine.field_error(name).
//     6. Provide onSubmit() that calls engine.submit() and checks the bool.
//     7. Use engine.data_version() in a useSyncExternalStore or similar
//        mechanism to trigger re-renders only when state actually changes.
//
// =============================================================================

use wasm_bindgen::prelude::*;
use std::collections::{HashMap, HashSet};

// -----------------------------------------------------------------------------
// FormEngine struct
// -----------------------------------------------------------------------------
// All form state lives here. The struct is opaque to JS; only the
// #[wasm_bindgen] methods below are callable from TypeScript.
// -----------------------------------------------------------------------------

#[wasm_bindgen]
pub struct FormEngine {
    /// Current value for each registered field.
    values: HashMap<String, String>,

    /// The initial (default or server-loaded) value for each field.
    /// Used by dirty tracking and reset().
    initial_values: HashMap<String, String>,

    /// Per-field validation error messages. Empty string key = no entry = valid.
    /// A field is valid if it has no entry in this map.
    errors: HashMap<String, String>,

    /// Fields that have been blurred at least once. We only show errors for
    /// touched fields (or after submit) to avoid yelling at the user before
    /// they've had a chance to type.
    touched: HashSet<String>,

    /// Fields whose current value differs from their initial value.
    dirty: HashSet<String>,

    /// Whether submit() has been called at least once. After submission,
    /// all fields are treated as touched so all errors show immediately.
    submitted: bool,

    /// Monotonically increasing counter, bumped on every state mutation.
    /// The TS side can store the last-seen version and skip re-renders
    /// when nothing changed.
    data_version: u32,
}

// =============================================================================
// WASM-exposed methods (callable from TypeScript)
// =============================================================================

#[wasm_bindgen]
impl FormEngine {
    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// Create a new FormEngine with all fields registered and set to defaults.
    #[wasm_bindgen(constructor)]
    pub fn new() -> FormEngine {
        let mut engine = FormEngine {
            values: HashMap::new(),
            initial_values: HashMap::new(),
            errors: HashMap::new(),
            touched: HashSet::new(),
            dirty: HashSet::new(),
            submitted: false,
            data_version: 0,
        };
        engine.init_fields();
        engine
    }

    // -------------------------------------------------------------------------
    // Field mutation
    // -------------------------------------------------------------------------

    /// Called by the TS onChange handler. Updates the field value, recomputes
    /// dirty state, runs validation for this field, and bumps data_version.
    pub fn set_field(&mut self, name: &str, value: &str) {
        // Store the new value.
        self.values.insert(name.to_string(), value.to_string());

        // Dirty tracking: compare to initial value.
        let is_dirty = self
            .initial_values
            .get(name)
            .map(|init| init != value)
            .unwrap_or(true);

        if is_dirty {
            self.dirty.insert(name.to_string());
        } else {
            self.dirty.remove(name);
        }

        // Validate this single field.
        match self.validate_field_internal(name, value) {
            Ok(()) => {
                self.errors.remove(name);
            }
            Err(msg) => {
                self.errors.insert(name.to_string(), msg);
            }
        }

        self.data_version += 1;
    }

    /// Called by the TS onBlur handler. Marks the field as touched so that
    /// its error (if any) will be displayed.
    pub fn touch_field(&mut self, name: &str) {
        self.touched.insert(name.to_string());
        self.data_version += 1;
    }

    // -------------------------------------------------------------------------
    // Field queries
    // -------------------------------------------------------------------------

    /// Returns the current value of a field, or "" if not registered.
    pub fn field_value(&self, name: &str) -> String {
        self.values.get(name).cloned().unwrap_or_default()
    }

    /// Returns the validation error for a field, or "" if valid.
    /// Only returns an error if the field has been touched (or submitted).
    pub fn field_error(&self, name: &str) -> String {
        // Only surface errors for fields the user has interacted with,
        // unless the form has been submitted (then show all errors).
        if !self.submitted && !self.touched.contains(name) {
            return String::new();
        }
        self.errors.get(name).cloned().unwrap_or_default()
    }

    /// Returns true if the field has been blurred at least once.
    pub fn field_touched(&self, name: &str) -> bool {
        self.touched.contains(name)
    }

    /// Returns true if the field's current value differs from its initial value.
    pub fn field_dirty(&self, name: &str) -> bool {
        self.dirty.contains(name)
    }

    // -------------------------------------------------------------------------
    // Form-level queries
    // -------------------------------------------------------------------------

    /// Returns true if the errors map is empty (all fields pass validation).
    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }

    /// Returns true if any field's value differs from its initial value.
    pub fn is_dirty(&self) -> bool {
        !self.dirty.is_empty()
    }

    /// Returns true if the form can be submitted. Override this to add
    /// additional guards (e.g., require is_dirty, require network idle, etc.).
    pub fn can_submit(&self) -> bool {
        self.is_valid()
    }

    /// Returns true if submit() has been called at least once.
    pub fn has_been_submitted(&self) -> bool {
        self.submitted
    }

    // -------------------------------------------------------------------------
    // Submit / Reset
    // -------------------------------------------------------------------------

    /// Touch all fields, validate everything, set submitted flag, bump version.
    /// Returns true if the form is valid (caller should proceed with the
    /// network request), false if there are validation errors.
    pub fn submit(&mut self) -> bool {
        // Touch every registered field so all errors become visible.
        for name in self.values.keys() {
            self.touched.insert(name.clone());
        }

        // Run full validation.
        self.validate_all();

        self.submitted = true;
        self.data_version += 1;

        self.is_valid()
    }

    /// Restore all fields to their initial values. Clear touched, dirty,
    /// errors, and submitted. Bump version.
    pub fn reset(&mut self) {
        // Copy initial values back into current values.
        for (name, init) in &self.initial_values {
            self.values.insert(name.clone(), init.clone());
        }

        self.errors.clear();
        self.touched.clear();
        self.dirty.clear();
        self.submitted = false;
        self.data_version += 1;
    }

    /// Returns the current data version. The TS side can compare this to a
    /// previously stored version to decide whether a re-render is needed.
    pub fn data_version(&self) -> u32 {
        self.data_version
    }
}

// =============================================================================
// Internal methods (NOT exposed to WASM / TypeScript)
// =============================================================================

impl FormEngine {
    // -------------------------------------------------------------------------
    // Field registration
    // -------------------------------------------------------------------------

    /// Register all fields with their default values. Called once from new().
    ///
    /// CUSTOMIZE THIS: Add one init_field() call per form field.
    fn init_fields(&mut self) {
        // Example fields -- replace with your actual form fields:
        self.init_field("name", "");
        self.init_field("email", "");
        self.init_field("age", "");
        self.init_field("password", "");
        self.init_field("confirm_password", "");
    }

    /// Register a single field with its default value in both `values` and
    /// `initial_values`. The field starts clean (not dirty, not touched).
    fn init_field(&mut self, name: &str, default: &str) {
        self.values.insert(name.to_string(), default.to_string());
        self.initial_values
            .insert(name.to_string(), default.to_string());
    }

    // -------------------------------------------------------------------------
    // Per-field validation
    // -------------------------------------------------------------------------

    /// Dispatch validation for a single field based on its name.
    ///
    /// CUSTOMIZE THIS: Add a match arm for each field. Use the chainable
    /// validators from the shared crate:
    ///
    ///   use shared::validation::{validate};
    ///
    ///   "email" => validate(value).required().email().finish(),
    ///   "age"   => validate(value).required().positive_f64().range_f64(1.0, 150.0).finish(),
    ///   "name"  => validate(value).required().min_length(2).max_length(100).finish(),
    ///
    /// If a field has no validation, return Ok(()).
    fn validate_field_internal(&mut self, name: &str, value: &str) -> Result<(), String> {
        match name {
            // ------------------------------------------------------------------
            // Example validation rules -- replace with your actual rules:
            // ------------------------------------------------------------------
            "name" => {
                if value.is_empty() {
                    return Err("Name is required".to_string());
                }
                if value.len() < 2 {
                    return Err("Name must be at least 2 characters".to_string());
                }
                Ok(())
            }

            "email" => {
                if value.is_empty() {
                    return Err("Email is required".to_string());
                }
                // Basic email check -- use validate(value).email() from shared crate
                // for the real implementation.
                if !value.contains('@') || !value.split('@').nth(1).map_or(false, |d| d.contains('.')) {
                    return Err("Please enter a valid email address".to_string());
                }
                Ok(())
            }

            "age" => {
                if value.is_empty() {
                    return Err("Age is required".to_string());
                }
                match value.parse::<f64>() {
                    Ok(n) if n > 0.0 && n <= 150.0 => Ok(()),
                    Ok(_) => Err("Age must be between 1 and 150".to_string()),
                    Err(_) => Err("Age must be a number".to_string()),
                }
            }

            "password" => {
                if value.is_empty() {
                    return Err("Password is required".to_string());
                }
                if value.len() < 8 {
                    return Err("Password must be at least 8 characters".to_string());
                }
                Ok(())
            }

            "confirm_password" => {
                if value.is_empty() {
                    return Err("Please confirm your password".to_string());
                }
                // Cross-field check is also done in validate_cross_fields(),
                // but we can catch the obvious case here too.
                let password = self.values.get("password").cloned().unwrap_or_default();
                if value != password {
                    return Err("Passwords do not match".to_string());
                }
                Ok(())
            }

            // Fields with no validation pass automatically.
            _ => Ok(()),
        }
    }

    // -------------------------------------------------------------------------
    // Cross-field validation
    // -------------------------------------------------------------------------

    /// Validate rules that span multiple fields. Called after all individual
    /// fields have been validated.
    ///
    /// CUSTOMIZE THIS: Add cross-field rules like password confirmation,
    /// "at least one of X or Y must be filled", date range checks, etc.
    fn validate_cross_fields(&mut self) {
        // Example: password confirmation
        let password = self.values.get("password").cloned().unwrap_or_default();
        let confirm = self
            .values
            .get("confirm_password")
            .cloned()
            .unwrap_or_default();

        if !confirm.is_empty() && password != confirm {
            self.errors.insert(
                "confirm_password".to_string(),
                "Passwords do not match".to_string(),
            );
        }
    }

    // -------------------------------------------------------------------------
    // Full validation
    // -------------------------------------------------------------------------

    /// Validate all fields individually, then run cross-field validation.
    /// Called by submit(). You can also call this manually if you need to
    /// eagerly validate everything (e.g., on a "validate" button click).
    fn validate_all(&mut self) {
        // Collect field names first to avoid borrow conflict.
        let fields: Vec<(String, String)> = self
            .values
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        for (name, value) in &fields {
            match self.validate_field_internal(name, value) {
                Ok(()) => {
                    self.errors.remove(name.as_str());
                }
                Err(msg) => {
                    self.errors.insert(name.clone(), msg);
                }
            }
        }

        self.validate_cross_fields();
    }
}

// =============================================================================
// WIZARD / MULTI-STEP FORM EXTENSION (commented out)
// =============================================================================
//
// If your form has multiple steps (a wizard), uncomment and extend the
// following. The pattern is:
//
//   - `current_step: usize` tracks which step is visible.
//   - `step_count: usize` is the total number of steps.
//   - `fields_for_step(step)` returns the field names belonging to that step.
//   - `advance()` validates the current step's fields; if valid, moves forward.
//   - `go_back()` moves backward without validation.
//   - `can_advance()` checks whether the current step's fields are all valid.
//
// #[wasm_bindgen]
// impl FormEngine {
//     /// Returns the current step index (0-based).
//     pub fn current_step(&self) -> usize {
//         self.current_step
//     }
//
//     /// Returns the total number of steps.
//     pub fn step_count(&self) -> usize {
//         self.step_count
//     }
//
//     /// Returns true if we are on the last step.
//     pub fn is_last_step(&self) -> bool {
//         self.current_step == self.step_count - 1
//     }
//
//     /// Advance to the next step. Validates the current step's fields first.
//     /// Returns true if advancement succeeded (current step was valid).
//     pub fn advance(&mut self) -> bool {
//         let step_fields = self.fields_for_step(self.current_step);
//
//         // Touch and validate all fields in the current step.
//         for name in &step_fields {
//             self.touched.insert(name.clone());
//             let value = self.values.get(name).cloned().unwrap_or_default();
//             match self.validate_field_internal(name, &value) {
//                 Ok(()) => { self.errors.remove(name.as_str()); }
//                 Err(msg) => { self.errors.insert(name.clone(), msg); }
//             }
//         }
//
//         // Check if any of this step's fields have errors.
//         let step_valid = step_fields.iter().all(|f| !self.errors.contains_key(f));
//
//         if step_valid && self.current_step < self.step_count - 1 {
//             self.current_step += 1;
//             self.data_version += 1;
//             true
//         } else {
//             self.data_version += 1;
//             false
//         }
//     }
//
//     /// Go back one step. No validation is performed.
//     pub fn go_back(&mut self) {
//         if self.current_step > 0 {
//             self.current_step -= 1;
//             self.data_version += 1;
//         }
//     }
//
//     /// Returns true if all fields in the current step are valid.
//     pub fn can_advance(&self) -> bool {
//         let step_fields = self.fields_for_step(self.current_step);
//         step_fields.iter().all(|f| !self.errors.contains_key(f))
//     }
// }
//
// impl FormEngine {
//     /// Returns the field names that belong to a given step.
//     ///
//     /// CUSTOMIZE THIS: Map step indices to field names.
//     fn fields_for_step(&self, step: usize) -> Vec<String> {
//         match step {
//             0 => vec!["name".to_string(), "email".to_string()],
//             1 => vec!["age".to_string()],
//             2 => vec!["password".to_string(), "confirm_password".to_string()],
//             _ => vec![],
//         }
//     }
// }
