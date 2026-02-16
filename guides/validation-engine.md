# Validation Engine Pattern

Rust-owned schema-based data validation with cross-field rules and async support. The WASM engine owns ALL validation state -- rules, schemas, field errors, cross-field rules, async validation tracking. TypeScript is a dumb form renderer that dispatches validation actions and reads errors back.

## When to Use

Use the validation engine when your app has:
- Complex validation schemas with multiple rule types
- Cross-field validation (password confirmation, date ranges)
- Async validation (username availability, server-side checks)
- Multiple forms sharing validation rules
- Dynamic schema composition

NOT for simple single-field validation. For that, use `IFormEngine` which has built-in validation.

## Quick Start

### 1. Implement IValidationEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/validation-engine-template.rs crates/my-engine/src/validation.rs
```

Customize:
1. **Custom rule types** -- add domain-specific validation logic
2. **Error messages** -- customize messages per rule type

### 2. Wire with React Hooks

```tsx
import { useValidationEngine, useValidationState, useFieldValidation } from 'org-asm/react';

function RegistrationForm() {
  const engine = useMemo(() => new MyValidationEngine(), []);
  const handle = useValidationEngine(engine);

  useEffect(() => {
    if (!handle) return;
    // Define rules
    handle.addRule('required', 0, '{}');
    handle.addRule('email', 6, '{}');
    handle.addRule('minLen8', 3, '{"min":8}');

    // Define schema
    handle.addSchema('registration');
    handle.addSchemaField('registration', 'email', '["required","email"]');
    handle.addSchemaField('registration', 'password', '["required","minLen8"]');
    handle.addSchemaField('registration', 'confirmPassword', '["required"]');

    // Cross-field: passwords must match
    handle.addCrossFieldRule('registration', 0, '["password","confirmPassword"]', '{}');
  }, [handle]);

  const handleSubmit = () => {
    if (!handle) return;
    const data = { email, password, confirmPassword };
    const isValid = handle.validateJson('registration', JSON.stringify(data));
    if (isValid) submitForm(data);
  };

  return (
    <form onSubmit={handleSubmit}>
      <EmailField handle={handle} />
      <PasswordField handle={handle} />
      <button type="submit">Register</button>
    </form>
  );
}

function EmailField({ handle }: { handle: ValidationHandle | null }) {
  const { hasError, firstError } = useFieldValidation(handle, 'registration', 'email');
  return (
    <div>
      <input type="email" onChange={e => { /* update value */ }} />
      {hasError && <span className="error">{firstError}</span>}
    </div>
  );
}
```

### 3. Context (optional)

```tsx
import { createValidationContext } from 'org-asm/react';

const { ValidationProvider, useValidation, useValidationStatus, useFieldValidation } =
  createValidationContext<MyEngine>();
```

## IValidationEngine Contract

### Rules

| Method | Description |
|--------|-------------|
| `add_rule(rule_id, rule_type, params_json)` | Register a rule. Types: 0=required, 1=min, 2=max, 3=minLength, 4=maxLength, 5=pattern, 6=email, 7=custom |
| `remove_rule(rule_id)` | Remove a rule |
| `rule_count()` | Number of registered rules |
| `rule_id(index)` | Get rule ID by index |

### Schemas

| Method | Description |
|--------|-------------|
| `add_schema(schema_id)` | Create a validation schema |
| `add_schema_field(schema_id, field, rules_json)` | Add field with rule IDs (JSON array) |
| `remove_schema(schema_id)` | Remove a schema |
| `schema_count()` | Number of schemas |

### Validation

| Method | Description |
|--------|-------------|
| `validate_json(schema_id, data_json)` | Validate data, returns true if valid |
| `clear_errors(schema_id)` | Clear all errors for a schema |

### Errors

| Method | Description |
|--------|-------------|
| `error_count(schema_id)` | Total errors for a schema |
| `field_error_count(schema_id, field)` | Error count for a specific field |
| `field_error(schema_id, field, index)` | Get error message by index |
| `field_has_error(schema_id, field)` | Whether a field has errors |
| `field_errors_json(schema_id, field)` | All field errors as JSON array |

### Cross-Field Rules

| Method | Description |
|--------|-------------|
| `add_cross_field_rule(schema_id, type, fields_json, params_json)` | Types: 0=equal, 1=notEqual, 2=greaterThan, 3=lessThan, 4=custom |
| `cross_field_rule_count(schema_id)` | Number of cross-field rules |

### Async Validation

| Method | Description |
|--------|-------------|
| `start_validation(schema_id, field, rule_id)` | Start async validation, returns ID |
| `resolve_async_validation(id, is_valid, error)` | Complete async validation |
| `pending_validation_count()` | Number of pending validations |

## Rule Types

| Type | Value | Params | Description |
|------|-------|--------|-------------|
| Required | 0 | `{}` | Field must be non-empty |
| Min | 1 | `{"min":N}` | Numeric value >= N |
| Max | 2 | `{"max":N}` | Numeric value <= N |
| MinLength | 3 | `{"min":N}` | String length >= N |
| MaxLength | 4 | `{"max":N}` | String length <= N |
| Pattern | 5 | `{"pattern":"..."}` | String matches pattern |
| Email | 6 | `{}` | Contains '@' and '.' |
| Custom | 7 | `{...}` | Engine-specific validation |

## Types

### ValidationState

```typescript
interface ValidationState {
  ruleCount: number;
  schemaCount: number;
  pendingValidationCount: number;
  dataVersion: number;
}
```

### FieldValidation

```typescript
interface FieldValidation {
  schemaId: string;
  field: string;
  errorCount: number;
  hasError: boolean;
  firstError: string;
}
```
