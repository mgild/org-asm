// =============================================================================
// Validation Template — Chainable Validator Builder
// =============================================================================
//
// This module provides two ways to validate form field values:
//
//   1. CHAINABLE BUILDER (recommended for multi-rule fields):
//
//        use shared::validation::{validate};
//
//        let result = validate(value)
//            .required()
//            .min_length(2)
//            .max_length(100)
//            .finish();
//
//      Once any validator in the chain fails, all subsequent validators are
//      skipped (early-return on first error). The final `.finish()` returns
//      `Result<(), String>` — Ok(()) if all passed, Err(msg) with the first
//      error message.
//
//   2. STANDALONE FUNCTIONS (convenient for single-rule checks):
//
//        use shared::validation::{required, email, positive_f64};
//
//        required(value)?;
//        email(value)?;
//
//      Each function returns `Result<(), String>` independently.
//
// HOW TO ADD A NEW VALIDATOR:
//
//   1. Add a method on Validator that checks the condition and returns self.
//   2. If the result is already Err, return self immediately (skip check).
//   3. Optionally add a standalone function that wraps the same logic.
//
// =============================================================================

// -----------------------------------------------------------------------------
// Chainable Validator
// -----------------------------------------------------------------------------

/// A chainable validator that accumulates the first error encountered.
///
/// The `value` field holds a reference to the string being validated.
/// The `result` field starts as Ok(()) and is set to Err(msg) on the first
/// failing check. Once `result` is Err, all subsequent checks are no-ops.
pub struct Validator<'a> {
    value: &'a str,
    result: Result<(), String>,
}

/// Start a validation chain for the given value.
///
/// # Example
///
/// ```
/// let result = validate("hello@example.com")
///     .required()
///     .email()
///     .finish();
/// assert!(result.is_ok());
/// ```
pub fn validate(value: &str) -> Validator<'_> {
    Validator {
        value,
        result: Ok(()),
    }
}

impl<'a> Validator<'a> {
    /// Fails if the value is empty (after trimming).
    pub fn required(self) -> Self {
        if self.result.is_err() {
            return self;
        }
        if self.value.trim().is_empty() {
            return Validator {
                value: self.value,
                result: Err("This field is required".to_string()),
            };
        }
        self
    }

    /// Fails if the value has fewer than `n` characters.
    pub fn min_length(self, n: usize) -> Self {
        if self.result.is_err() {
            return self;
        }
        if self.value.len() < n {
            return Validator {
                value: self.value,
                result: Err(format!("Must be at least {} characters", n)),
            };
        }
        self
    }

    /// Fails if the value has more than `n` characters.
    pub fn max_length(self, n: usize) -> Self {
        if self.result.is_err() {
            return self;
        }
        if self.value.len() > n {
            return Validator {
                value: self.value,
                result: Err(format!("Must be at most {} characters", n)),
            };
        }
        self
    }

    /// Basic email check: must contain '@' with a '.' somewhere after it.
    /// This is intentionally simple — server-side validation should do the
    /// heavy lifting. The goal here is to catch obvious typos.
    pub fn email(self) -> Self {
        if self.result.is_err() {
            return self;
        }
        let valid = self.value.contains('@')
            && self
                .value
                .split('@')
                .nth(1)
                .map_or(false, |domain| domain.contains('.'));
        if !valid {
            return Validator {
                value: self.value,
                result: Err("Please enter a valid email address".to_string()),
            };
        }
        self
    }

    /// Fails if the value cannot be parsed as an f64.
    pub fn parse_f64(self) -> Self {
        if self.result.is_err() {
            return self;
        }
        if self.value.parse::<f64>().is_err() {
            return Validator {
                value: self.value,
                result: Err("Must be a valid number".to_string()),
            };
        }
        self
    }

    /// Fails if the value is not a positive f64 (must parse AND be > 0).
    pub fn positive_f64(self) -> Self {
        if self.result.is_err() {
            return self;
        }
        match self.value.parse::<f64>() {
            Ok(n) if n > 0.0 => self,
            Ok(_) => Validator {
                value: self.value,
                result: Err("Must be a positive number".to_string()),
            },
            Err(_) => Validator {
                value: self.value,
                result: Err("Must be a valid number".to_string()),
            },
        }
    }

    /// Fails if the value is not an f64 within [min, max] (inclusive).
    pub fn range_f64(self, min: f64, max: f64) -> Self {
        if self.result.is_err() {
            return self;
        }
        match self.value.parse::<f64>() {
            Ok(n) if n >= min && n <= max => self,
            Ok(_) => Validator {
                value: self.value,
                result: Err(format!("Must be between {} and {}", min, max)),
            },
            Err(_) => Validator {
                value: self.value,
                result: Err("Must be a valid number".to_string()),
            },
        }
    }

    /// Fails if the value does not exactly match the given pattern string.
    /// This is a simple equality check, NOT regex.
    pub fn matches(self, pattern: &str) -> Self {
        if self.result.is_err() {
            return self;
        }
        if self.value != pattern {
            return Validator {
                value: self.value,
                result: Err(format!("Must match \"{}\"", pattern)),
            };
        }
        self
    }

    /// Run an arbitrary validation function. The function receives the value
    /// and should return Ok(()) on success or Err(msg) on failure.
    ///
    /// # Example
    ///
    /// ```
    /// let result = validate("hello")
    ///     .custom(|v| {
    ///         if v.starts_with('h') {
    ///             Ok(())
    ///         } else {
    ///             Err("Must start with 'h'".to_string())
    ///         }
    ///     })
    ///     .finish();
    /// ```
    pub fn custom(self, f: impl FnOnce(&str) -> Result<(), String>) -> Self {
        if self.result.is_err() {
            return self;
        }
        match f(self.value) {
            Ok(()) => self,
            Err(msg) => Validator {
                value: self.value,
                result: Err(msg),
            },
        }
    }

    /// Consume the validator and return the accumulated result.
    /// Ok(()) if all checks passed, Err(msg) with the first error otherwise.
    pub fn finish(self) -> Result<(), String> {
        self.result
    }
}

// =============================================================================
// Standalone convenience functions
// =============================================================================
//
// These are useful when you only need a single check, or when composing
// validation in a non-builder style (e.g., in a match arm):
//
//   match name {
//       "email" => { required(value)?; email(value)?; Ok(()) }
//       "age"   => { required(value)?; positive_f64(value)?; Ok(()) }
//   }
//

/// Fails if the value is empty (after trimming).
pub fn required(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("This field is required".to_string());
    }
    Ok(())
}

/// Fails if the value has fewer than `n` characters.
pub fn min_length(value: &str, n: usize) -> Result<(), String> {
    if value.len() < n {
        return Err(format!("Must be at least {} characters", n));
    }
    Ok(())
}

/// Fails if the value cannot be parsed as an f64.
pub fn parse_f64(value: &str) -> Result<(), String> {
    value
        .parse::<f64>()
        .map(|_| ())
        .map_err(|_| "Must be a valid number".to_string())
}

/// Fails if the value is not a positive f64.
pub fn positive_f64(value: &str) -> Result<(), String> {
    match value.parse::<f64>() {
        Ok(n) if n > 0.0 => Ok(()),
        Ok(_) => Err("Must be a positive number".to_string()),
        Err(_) => Err("Must be a valid number".to_string()),
    }
}

/// Fails if the value is not an f64 within [min, max] (inclusive).
pub fn range_f64(value: &str, min: f64, max: f64) -> Result<(), String> {
    match value.parse::<f64>() {
        Ok(n) if n >= min && n <= max => Ok(()),
        Ok(_) => Err(format!("Must be between {} and {}", min, max)),
        Err(_) => Err("Must be a valid number".to_string()),
    }
}

/// Basic email validation: must contain '@' with a '.' after it.
pub fn email(value: &str) -> Result<(), String> {
    let valid = value.contains('@')
        && value
            .split('@')
            .nth(1)
            .map_or(false, |domain| domain.contains('.'));
    if !valid {
        return Err("Please enter a valid email address".to_string());
    }
    Ok(())
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Chainable validator tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_chain_all_pass() {
        let result = validate("hello@example.com")
            .required()
            .min_length(5)
            .max_length(100)
            .email()
            .finish();
        assert!(result.is_ok());
    }

    #[test]
    fn test_chain_required_fails_on_empty() {
        let result = validate("").required().finish();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "This field is required");
    }

    #[test]
    fn test_chain_required_fails_on_whitespace() {
        let result = validate("   ").required().finish();
        assert!(result.is_err());
    }

    #[test]
    fn test_chain_early_return_skips_later_checks() {
        // required() fails, so min_length() should be skipped.
        // If min_length ran on "", it would produce a different error message.
        let result = validate("")
            .required()
            .min_length(10)
            .finish();
        assert_eq!(result.unwrap_err(), "This field is required");
    }

    #[test]
    fn test_chain_min_length() {
        let result = validate("ab").min_length(3).finish();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Must be at least 3 characters");

        let result = validate("abc").min_length(3).finish();
        assert!(result.is_ok());
    }

    #[test]
    fn test_chain_max_length() {
        let result = validate("abcdef").max_length(5).finish();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Must be at most 5 characters");

        let result = validate("abcde").max_length(5).finish();
        assert!(result.is_ok());
    }

    #[test]
    fn test_chain_email_valid() {
        assert!(validate("user@example.com").email().finish().is_ok());
        assert!(validate("a@b.c").email().finish().is_ok());
    }

    #[test]
    fn test_chain_email_invalid() {
        assert!(validate("noatsign").email().finish().is_err());
        assert!(validate("no@dot").email().finish().is_err());
        assert!(validate("@nodomain.com").email().finish().is_ok()); // has @ and . after
        assert!(validate("user@").email().finish().is_err());
    }

    #[test]
    fn test_chain_parse_f64() {
        assert!(validate("42.5").parse_f64().finish().is_ok());
        assert!(validate("-3.14").parse_f64().finish().is_ok());
        assert!(validate("not_a_number").parse_f64().finish().is_err());
    }

    #[test]
    fn test_chain_positive_f64() {
        assert!(validate("1.0").positive_f64().finish().is_ok());
        assert!(validate("0.001").positive_f64().finish().is_ok());
        assert!(validate("0").positive_f64().finish().is_err());
        assert!(validate("-5").positive_f64().finish().is_err());
        assert!(validate("abc").positive_f64().finish().is_err());
    }

    #[test]
    fn test_chain_range_f64() {
        assert!(validate("5").range_f64(1.0, 10.0).finish().is_ok());
        assert!(validate("1").range_f64(1.0, 10.0).finish().is_ok());
        assert!(validate("10").range_f64(1.0, 10.0).finish().is_ok());
        assert!(validate("0").range_f64(1.0, 10.0).finish().is_err());
        assert!(validate("11").range_f64(1.0, 10.0).finish().is_err());
        assert!(validate("abc").range_f64(1.0, 10.0).finish().is_err());
    }

    #[test]
    fn test_chain_matches() {
        assert!(validate("exact").matches("exact").finish().is_ok());
        assert!(validate("wrong").matches("exact").finish().is_err());
    }

    #[test]
    fn test_chain_custom() {
        let result = validate("hello")
            .custom(|v| {
                if v.starts_with('h') {
                    Ok(())
                } else {
                    Err("Must start with 'h'".to_string())
                }
            })
            .finish();
        assert!(result.is_ok());

        let result = validate("world")
            .custom(|v| {
                if v.starts_with('h') {
                    Ok(())
                } else {
                    Err("Must start with 'h'".to_string())
                }
            })
            .finish();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Must start with 'h'");
    }

    #[test]
    fn test_chain_complex() {
        // A realistic multi-check chain.
        let result = validate("25")
            .required()
            .parse_f64()
            .positive_f64()
            .range_f64(1.0, 150.0)
            .finish();
        assert!(result.is_ok());

        let result = validate("")
            .required()
            .parse_f64()
            .positive_f64()
            .range_f64(1.0, 150.0)
            .finish();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "This field is required");
    }

    // -------------------------------------------------------------------------
    // Standalone function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_standalone_required() {
        assert!(required("hello").is_ok());
        assert!(required("").is_err());
        assert!(required("  ").is_err());
    }

    #[test]
    fn test_standalone_min_length() {
        assert!(min_length("abc", 3).is_ok());
        assert!(min_length("ab", 3).is_err());
    }

    #[test]
    fn test_standalone_parse_f64() {
        assert!(parse_f64("3.14").is_ok());
        assert!(parse_f64("abc").is_err());
    }

    #[test]
    fn test_standalone_positive_f64() {
        assert!(positive_f64("1").is_ok());
        assert!(positive_f64("0").is_err());
        assert!(positive_f64("-1").is_err());
        assert!(positive_f64("abc").is_err());
    }

    #[test]
    fn test_standalone_range_f64() {
        assert!(range_f64("5", 1.0, 10.0).is_ok());
        assert!(range_f64("0", 1.0, 10.0).is_err());
        assert!(range_f64("abc", 1.0, 10.0).is_err());
    }

    #[test]
    fn test_standalone_email() {
        assert!(email("user@example.com").is_ok());
        assert!(email("nope").is_err());
        assert!(email("no@dot").is_err());
    }
}
