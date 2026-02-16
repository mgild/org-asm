# Form Engine Pattern

Rust-owned form state with per-field reactive rendering. The WASM engine owns ALL form state — values, errors, touched/dirty tracking, submission lifecycle. TypeScript is a dumb input renderer.

## When to Use

Use the form engine when your form has:
- Validation rules that belong in Rust (shared with server, complex domain logic)
- Cross-field validation (password confirmation, date ranges)
- Multi-step wizards with per-step validation
- Forms where you want zero JS-side state duplication

For simple forms with 1-2 fields and no cross-field validation, `useWasmCall` with `validate_field()` (see `guides/form-validation.md`) may be simpler.

## Quick Start

### 1. Implement IFormEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/form-engine-template.rs crates/my-engine/src/form.rs
```

Customize `init_fields()` to register your fields and `validate_field_internal()` to dispatch validation per field name. Use the chainable validators from `shared/validation-template.rs`.

### 2. Wire with React Hooks

```tsx
import { useFormEngine, useFormField, useFormState } from 'org-asm/react';

function MyForm() {
  const engine = useMemo(() => new MyFormEngine(), []);
  const handle = useFormEngine(engine);

  return (
    <form onSubmit={e => { e.preventDefault(); handle?.submit(); }}>
      <EmailField handle={handle} />
      <SubmitButton handle={handle} />
    </form>
  );
}

function EmailField({ handle }: { handle: FormHandle | null }) {
  const { value, error, showError } = useFormField(handle, 'email');
  return (
    <div>
      <input
        value={value}
        onChange={e => handle?.setField('email', e.target.value)}
        onBlur={() => handle?.touchField('email')}
      />
      {showError && <span className="error">{error}</span>}
    </div>
  );
}

function SubmitButton({ handle }: { handle: FormHandle | null }) {
  const { canSubmit } = useFormState(handle);
  return <button type="submit" disabled={!canSubmit}>Submit</button>;
}
```

### 3. Context (optional — no prop drilling)

```tsx
import { createFormContext } from 'org-asm/react';

const { FormProvider, useForm, useField, useFormStatus } = createFormContext<MyFormEngine>();

function App() {
  const engine = useMemo(() => new MyFormEngine(), []);
  return (
    <FormProvider engine={engine}>
      <MyForm />
    </FormProvider>
  );
}

function EmailField() {
  const { setField, touchField } = useForm();
  const { value, error, showError } = useField('email');
  // ...
}
```

## IFormEngine Contract

| Method | Type | Description |
|--------|------|-------------|
| `set_field(name, value)` | `&mut self` | Update value, compute dirty, validate, bump version |
| `touch_field(name)` | `&mut self` | Mark field as touched (on blur), bump version |
| `field_value(name)` | `&self` | Current field value |
| `field_error(name)` | `&self` | Validation error (empty string = valid) |
| `field_touched(name)` | `&self` | Whether field has been blurred |
| `field_dirty(name)` | `&self` | Whether value differs from initial |
| `is_valid()` | `&self` | All fields pass validation |
| `is_dirty()` | `&self` | Any field has changed |
| `can_submit()` | `&self` | Form is submittable |
| `has_been_submitted()` | `&self` | submit() called at least once |
| `submit()` | `&mut self` | Touch all, validate all, return is_valid |
| `reset()` | `&mut self` | Restore initial values, clear all tracking |
| `data_version()` | `&self` | Monotonically increasing change counter |

## Per-Field Reactivity

Each `useFormField(handle, 'name')` call subscribes to the notifier via `useWasmSelector` with shallow equality. When `handle.setField('email', ...)` is called, the notifier fires. Every `useFormField` re-reads its snapshot, but only re-renders if its field's state actually changed.

This means typing in the email field does NOT re-render the password field.

## Error Display Strategy

The `showError` flag in `FieldState` implements a common UX pattern:

```
showError = (touched || submitted) && error !== ''
```

- Before interaction: errors are hidden (user hasn't seen the field yet)
- After blur (touched): errors show for that field
- After submit: ALL errors show (even untouched fields)

## Rust Validation

Use the chainable validator from `shared/validation-template.rs`:

```rust
fn validate_field_internal(&mut self, name: &str, value: &str) -> Result<(), String> {
    match name {
        "email" => validate(value).required().email().finish(),
        "amount" => validate(value).required().positive_f64().finish(),
        "name" => validate(value).required().min_length(2).max_length(50).finish(),
        _ => Ok(()),
    }
}
```

### Cross-Field Validation

Override `validate_cross_fields()` for rules that span multiple fields:

```rust
fn validate_cross_fields(&mut self) {
    let password = self.values.get("password").cloned().unwrap_or_default();
    let confirm = self.values.get("confirm_password").cloned().unwrap_or_default();
    if !password.is_empty() && password != confirm {
        self.errors.insert("confirm_password".into(), "Passwords do not match".into());
    }
}
```

## Wizards (IWizardFormEngine)

For multi-step forms, implement `IWizardFormEngine` which extends `IFormEngine` with step navigation:

```rust
// Step tracking
step: usize,
step_count: usize,
step_fields: Vec<Vec<String>>,  // fields per step

// advance() validates only current step's fields
pub fn advance(&mut self) -> bool {
    let fields = &self.step_fields[self.step];
    // validate only these fields...
    if valid { self.step += 1; }
    valid
}
```

## Testing

Mock the engine in tests with a plain JS object:

```typescript
function createMockEngine(): IFormEngine {
  const values = new Map<string, string>();
  const errors = new Map<string, string>();
  // ... see test files for full mock
}
```

Use `renderHook` from `@testing-library/react` to test hooks in isolation. The form engine hooks follow the same testing patterns as `useWasmState` and `useWasmSelector`.
