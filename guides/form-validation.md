# Guide: Rust-Owned Form Validation

## When to Use

When forms need validation logic that:
- Shares rules between server and client (one Rust crate, two targets)
- Has cross-field dependencies (field A's validity depends on field B)
- Requires complex domain logic (price ranges, quantity limits, regulatory checks)
- Should be unit-tested without a browser (`cargo test`)

## The Pattern

Rust owns ALL validation rules. TypeScript handles form rendering and user feedback. The bridge is `useWasmCall` + `WasmResult<T>`.

```
User types → React onChange → engine.validate_field(name, value)
                            → engine.validate_form()
                            ↓
            Rust validates → WasmResult<T> (ok/error per field)
                            ↓
            React renders → field-level error messages
```

## Rust Engine: Validation Methods

```rust
use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

#[derive(Serialize)]
struct FieldError {
    field: String,
    message: String,
}

#[derive(Serialize)]
struct ValidationResult {
    ok: bool,
    errors: Vec<FieldError>,
}

#[wasm_bindgen]
impl OrderFormEngine {
    /// Validate a single field. Returns JSON: { ok: true } or { ok: false, error: "..." }
    pub fn validate_field(&self, field: &str, value: &str) -> String {
        let result = match field {
            "price" => self.validate_price(value),
            "quantity" => self.validate_quantity(value),
            "symbol" => self.validate_symbol(value),
            _ => Ok(()),
        };
        match result {
            Ok(()) => r#"{"ok":true}"#.to_string(),
            Err(msg) => format!(r#"{{"ok":false,"error":"{}"}}"#, msg),
        }
    }

    /// Validate entire form. Returns JSON with all field errors.
    pub fn validate_form(&self) -> String {
        let mut errors = Vec::new();

        if self.price <= 0.0 {
            errors.push(FieldError {
                field: "price".into(),
                message: "Price must be positive".into(),
            });
        }
        if self.quantity == 0 {
            errors.push(FieldError {
                field: "quantity".into(),
                message: "Quantity required".into(),
            });
        }

        // Cross-field: notional value check
        let notional = self.price * self.quantity as f64;
        if notional > self.max_notional {
            errors.push(FieldError {
                field: "quantity".into(),
                message: format!("Notional ${:.2} exceeds limit ${:.2}",
                    notional, self.max_notional),
            });
        }

        serde_json::to_string(&ValidationResult {
            ok: errors.is_empty(),
            errors,
        }).unwrap()
    }

    // Internal validators
    fn validate_price(&self, raw: &str) -> Result<(), String> {
        let price: f64 = raw.parse().map_err(|_| "Invalid number")?;
        if price <= 0.0 { return Err("Must be positive".into()); }
        if price > self.max_price { return Err(format!("Max price: {}", self.max_price)); }
        Ok(())
    }

    fn validate_quantity(&self, raw: &str) -> Result<(), String> {
        let qty: u64 = raw.parse().map_err(|_| "Must be a whole number")?;
        if qty == 0 { return Err("Required".into()); }
        if qty > self.max_quantity { return Err(format!("Max: {}", self.max_quantity)); }
        Ok(())
    }

    fn validate_symbol(&self, symbol: &str) -> Result<(), String> {
        if symbol.is_empty() { return Err("Required".into()); }
        if !self.known_symbols.contains(symbol) {
            return Err("Unknown symbol".into());
        }
        Ok(())
    }
}
```

Test without a browser:
```rust
#[test]
fn cross_field_notional_limit() {
    let mut engine = OrderFormEngine::new();
    engine.set_max_notional(100_000.0);
    engine.set_field("price", "50000");
    engine.set_field("quantity", "3");
    let result: ValidationResult = serde_json::from_str(&engine.validate_form()).unwrap();
    assert!(!result.ok);
    assert!(result.errors.iter().any(|e| e.message.contains("exceeds limit")));
}
```

## TypeScript: Field-Level Validation with useWasmCall

```tsx
import { useWasmCall } from 'org-asm/react';
import type { WasmResult } from 'org-asm/core';

// Parse the engine's JSON result into a typed WasmResult
function parseResult(json: string): WasmResult<null> {
  const parsed = JSON.parse(json);
  return parsed.ok
    ? { ok: true, value: null }
    : { ok: false, error: parsed.error };
}

function OrderForm({ engine }: { engine: OrderFormEngine }) {
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [symbol, setSymbol] = useState('');

  // Validate each field when its value changes
  const priceResult = useWasmCall(
    () => parseResult(engine.validate_field('price', price)),
    [price],
  );
  const qtyResult = useWasmCall(
    () => parseResult(engine.validate_field('quantity', quantity)),
    [quantity],
  );
  const symbolResult = useWasmCall(
    () => parseResult(engine.validate_field('symbol', symbol)),
    [symbol],
  );

  return (
    <form>
      <Field label="Symbol" value={symbol} onChange={setSymbol} error={symbolResult} />
      <Field label="Price" value={price} onChange={setPrice} error={priceResult} />
      <Field label="Quantity" value={quantity} onChange={setQuantity} error={qtyResult} />
    </form>
  );
}

function Field({ label, value, onChange, error }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: WasmResult<null>;
}) {
  return (
    <div>
      <label>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} />
      {!error.ok && <span className="error">{error.error}</span>}
    </div>
  );
}
```

## Full-Form Validation with useWasmReducer

For forms with complex state (multi-step, cross-field, async), use `useWasmReducer` to keep all form state in the engine:

```tsx
import { useWasmReducer } from 'org-asm/react';

interface FormState {
  price: string;
  quantity: string;
  symbol: string;
  errors: Record<string, string>;
  isValid: boolean;
  notional: number;
}

type FormAction =
  | { type: 'set_field'; field: string; value: string }
  | { type: 'submit' }
  | { type: 'reset' };

function OrderForm({ engine }: { engine: OrderFormEngine }) {
  const [state, dispatch] = useWasmReducer<OrderFormEngine, FormState, FormAction>(
    engine,
    {
      getSnapshot: (e) => ({
        price: e.field_value('price'),
        quantity: e.field_value('quantity'),
        symbol: e.field_value('symbol'),
        errors: JSON.parse(e.field_errors()),
        isValid: e.is_valid(),
        notional: e.notional_value(),
      }),
      dispatch: (e, action) => {
        switch (action.type) {
          case 'set_field':
            e.set_field(action.field, action.value);
            break;
          case 'submit':
            e.submit();
            break;
          case 'reset':
            e.reset();
            break;
        }
      },
    },
  );

  return (
    <form onSubmit={e => { e.preventDefault(); dispatch({ type: 'submit' }); }}>
      <input
        value={state.price}
        onChange={e => dispatch({ type: 'set_field', field: 'price', value: e.target.value })}
      />
      {state.errors.price && <span className="error">{state.errors.price}</span>}

      <input
        value={state.quantity}
        onChange={e => dispatch({ type: 'set_field', field: 'quantity', value: e.target.value })}
      />
      {state.errors.quantity && <span className="error">{state.errors.quantity}</span>}

      <div>Notional: ${state.notional.toFixed(2)}</div>

      <button disabled={!state.isValid}>Place Order</button>
    </form>
  );
}
```

## Async Validation (Uniqueness Checks)

For validation that requires async operations (checking if a username exists, verifying an address):

```tsx
import { useAsyncWasmCall } from 'org-asm/react';

// Rust engine exposes an async method via wasm-bindgen-futures
// pub async fn validate_symbol_exists(&self, symbol: &str) -> String { ... }

function SymbolField({ engine, symbol }: { engine: OrderFormEngine; symbol: string }) {
  // Sync validation runs immediately
  const syncResult = useWasmCall(
    () => parseResult(engine.validate_field('symbol', symbol)),
    [symbol],
  );

  // Async validation runs after deps change (with cancellation)
  const { result: asyncResult, loading } = useAsyncWasmCall(
    () => engine.validate_symbol_exists(symbol).then(parseResult),
    [symbol],
  );

  // Show sync error first, then async
  const error = !syncResult.ok
    ? syncResult.error
    : loading
      ? null
      : asyncResult && !asyncResult.ok
        ? asyncResult.error
        : null;

  return (
    <div>
      <input value={symbol} />
      {loading && <span className="hint">Checking...</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
```

## Why Rust for Validation

1. **One source of truth** — same validation crate compiles to native (server) and WASM (client). Change a rule once, it applies everywhere.
2. **Type safety** — Rust's type system catches edge cases (overflow, NaN, empty strings) at compile time.
3. **Testable** — `cargo test` runs validation logic without a browser, React, or DOM.
4. **Cross-field rules** — Rust owns the entire form state, so cross-field validation (notional limits, date ranges, conditional requirements) is natural.
5. **Performance** — For complex validation (regex, large lookups, financial calculations), WASM outperforms JS.

## Anti-Patterns

1. **Duplicating rules in JS** — If validation exists in Rust, don't rewrite it in TypeScript "for speed." The WASM call is fast enough for any form interaction.
2. **Validating in React effects** — Don't use `useEffect` to trigger validation. `useWasmCall` runs synchronously when deps change — no extra render cycle.
3. **Storing errors in React state** — The engine should own error state. Read it via `getSnapshot`, don't duplicate it in `useState`.
4. **Parsing JSON in the hot path** — For field-level validation called on every keystroke, consider returning simple strings instead of JSON. Reserve JSON for full-form validation with multiple errors.
