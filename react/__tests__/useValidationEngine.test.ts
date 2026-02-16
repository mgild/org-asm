import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useValidationEngine } from '../useValidationEngine';
import type { IValidationEngine } from '../../core/interfaces';

interface MockRule {
  ruleId: string;
  ruleType: number;
  paramsJson: string;
}

interface MockSchema {
  schemaId: string;
  fields: Map<string, string[]>;
}

interface MockCrossFieldRule {
  schemaId: string;
  ruleType: number;
  fieldsJson: string;
  paramsJson: string;
}

interface MockPendingValidation {
  schemaId: string;
  field: string;
  ruleId: string;
}

function createMockEngine(): IValidationEngine & {
  _rules: MockRule[];
  _schemas: MockSchema[];
  _errors: Map<string, Map<string, string[]>>;
  _crossFieldRules: MockCrossFieldRule[];
  _pendingValidations: Map<number, MockPendingValidation>;
  _nextValidationId: number;
} {
  const rules: MockRule[] = [];
  const schemas: MockSchema[] = [];
  const errors = new Map<string, Map<string, string[]>>();
  const crossFieldRules: MockCrossFieldRule[] = [];
  const pendingValidations = new Map<number, MockPendingValidation>();
  let nextValidationId = 1;
  let version = 0;

  return {
    _rules: rules,
    _schemas: schemas,
    _errors: errors,
    _crossFieldRules: crossFieldRules,
    _pendingValidations: pendingValidations,
    _nextValidationId: nextValidationId,

    // --- Rules ---
    add_rule(ruleId: string, ruleType: number, paramsJson: string) {
      rules.push({ ruleId, ruleType, paramsJson });
      version++;
    },
    remove_rule(ruleId: string) {
      const idx = rules.findIndex(r => r.ruleId === ruleId);
      if (idx >= 0) rules.splice(idx, 1);
      version++;
    },
    rule_count() { return rules.length; },
    rule_id(index: number) { return rules[index]?.ruleId ?? ''; },

    // --- Schemas ---
    add_schema(schemaId: string) {
      schemas.push({ schemaId, fields: new Map() });
      version++;
    },
    add_schema_field(schemaId: string, field: string, rulesJson: string) {
      const schema = schemas.find(s => s.schemaId === schemaId);
      if (schema) {
        const ruleIds = JSON.parse(rulesJson) as string[];
        schema.fields.set(field, ruleIds);
      }
      version++;
    },
    remove_schema(schemaId: string) {
      const idx = schemas.findIndex(s => s.schemaId === schemaId);
      if (idx >= 0) schemas.splice(idx, 1);
      errors.delete(schemaId);
      version++;
    },
    schema_count() { return schemas.length; },
    schema_id(index: number) { return schemas[index]?.schemaId ?? ''; },

    // --- Validation ---
    validate_json(schemaId: string, dataJson: string) {
      const data = JSON.parse(dataJson) as Record<string, string>;
      const schemaErrors = new Map<string, string[]>();
      const schema = schemas.find(s => s.schemaId === schemaId);
      if (schema) {
        for (const [field, ruleIds] of schema.fields) {
          const fieldErrors: string[] = [];
          const value = data[field] ?? '';
          for (const rId of ruleIds) {
            const rule = rules.find(r => r.ruleId === rId);
            if (rule && rule.ruleType === 0 && value === '') {
              fieldErrors.push(`${field} is required`);
            }
          }
          if (fieldErrors.length > 0) {
            schemaErrors.set(field, fieldErrors);
          }
        }
      }
      errors.set(schemaId, schemaErrors);
      version++;
      // valid if no errors
      for (const errs of schemaErrors.values()) {
        if (errs.length > 0) return false;
      }
      return true;
    },
    clear_errors(schemaId: string) {
      errors.delete(schemaId);
      version++;
    },

    // --- Errors ---
    error_count(schemaId: string) {
      const schemaErrors = errors.get(schemaId);
      if (!schemaErrors) return 0;
      let count = 0;
      for (const errs of schemaErrors.values()) count += errs.length;
      return count;
    },
    field_error_count(schemaId: string, field: string) {
      return errors.get(schemaId)?.get(field)?.length ?? 0;
    },
    field_error(schemaId: string, field: string, index: number) {
      return errors.get(schemaId)?.get(field)?.[index] ?? '';
    },
    field_has_error(schemaId: string, field: string) {
      return (errors.get(schemaId)?.get(field)?.length ?? 0) > 0;
    },
    field_errors_json(schemaId: string, field: string) {
      const fieldErrors = errors.get(schemaId)?.get(field) ?? [];
      return JSON.stringify(fieldErrors);
    },

    // --- Cross-field ---
    add_cross_field_rule(schemaId: string, ruleType: number, fieldsJson: string, paramsJson: string) {
      crossFieldRules.push({ schemaId, ruleType, fieldsJson, paramsJson });
      version++;
    },
    cross_field_rule_count(schemaId: string) {
      return crossFieldRules.filter(r => r.schemaId === schemaId).length;
    },

    // --- Async ---
    start_validation(schemaId: string, field: string, ruleId: string) {
      const id = nextValidationId++;
      pendingValidations.set(id, { schemaId, field, ruleId });
      version++;
      return id;
    },
    resolve_async_validation(validationId: number, isValid: boolean, error: string) {
      const pending = pendingValidations.get(validationId);
      if (pending) {
        if (!isValid) {
          const schemaErrors = errors.get(pending.schemaId) ?? new Map<string, string[]>();
          const fieldErrors = schemaErrors.get(pending.field) ?? [];
          fieldErrors.push(error);
          schemaErrors.set(pending.field, fieldErrors);
          errors.set(pending.schemaId, schemaErrors);
        }
        pendingValidations.delete(validationId);
      }
      version++;
    },
    pending_validation_count() { return pendingValidations.size; },
    pending_validation_schema(validationId: number) {
      return pendingValidations.get(validationId)?.schemaId ?? '';
    },
    pending_validation_field(validationId: number) {
      return pendingValidations.get(validationId)?.field ?? '';
    },

    // --- Standard ---
    data_version() { return version; },
    reset() {
      rules.length = 0;
      schemas.length = 0;
      errors.clear();
      crossFieldRules.length = 0;
      pendingValidations.clear();
      nextValidationId = 1;
      version++;
    },
  };
}

describe('useValidationEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useValidationEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns ValidationHandle with all methods when engine is provided', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.notifier.subscribe).toBe('function');
    expect(typeof handle.notifier.notify).toBe('function');
    expect(typeof handle.addRule).toBe('function');
    expect(typeof handle.removeRule).toBe('function');
    expect(typeof handle.addSchema).toBe('function');
    expect(typeof handle.addSchemaField).toBe('function');
    expect(typeof handle.removeSchema).toBe('function');
    expect(typeof handle.clearErrors).toBe('function');
    expect(typeof handle.addCrossFieldRule).toBe('function');
    expect(typeof handle.resolveAsyncValidation).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.validateJson).toBe('function');
    expect(typeof handle.startValidation).toBe('function');
    expect(typeof handle.getValidationState).toBe('function');
    expect(typeof handle.getSchemaValidation).toBe('function');
    expect(typeof handle.getFieldValidation).toBe('function');
    expect(typeof handle.getFieldErrors).toBe('function');
  });

  it('addRule calls engine.add_rule and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.addRule('required', 0, '{}');
    });

    expect(engine.rule_count()).toBe(1);
    expect(engine.rule_id(0)).toBe('required');
    expect(spy).toHaveBeenCalled();
  });

  it('removeRule calls engine.remove_rule and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addRule('required', 0, '{}');
      handle.addRule('minLength', 3, '{"min":3}');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.removeRule('required');
    });

    expect(engine.rule_count()).toBe(1);
    expect(engine.rule_id(0)).toBe('minLength');
    expect(spy).toHaveBeenCalled();
  });

  it('addSchema calls engine.add_schema and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.addSchema('user');
    });

    expect(engine.schema_count()).toBe(1);
    expect(engine.schema_id(0)).toBe('user');
    expect(spy).toHaveBeenCalled();
  });

  it('addSchemaField calls engine.add_schema_field and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addRule('required', 0, '{}');
      handle.addSchema('user');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.addSchemaField('user', 'email', '["required"]');
    });

    expect(spy).toHaveBeenCalled();
  });

  it('removeSchema calls engine.remove_schema and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addSchema('user');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.removeSchema('user');
    });

    expect(engine.schema_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('clearErrors calls engine.clear_errors and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addRule('required', 0, '{}');
      handle.addSchema('user');
      handle.addSchemaField('user', 'email', '["required"]');
      handle.validateJson('user', '{"email":""}');
    });

    expect(engine.error_count('user')).toBeGreaterThan(0);

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.clearErrors('user');
    });

    expect(engine.error_count('user')).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('addCrossFieldRule calls engine.add_cross_field_rule and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addSchema('user');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.addCrossFieldRule('user', 0, '["password","confirmPassword"]', '{}');
    });

    expect(engine.cross_field_rule_count('user')).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('resolveAsyncValidation calls engine.resolve_async_validation and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addSchema('user');
      handle.addSchemaField('user', 'username', '[]');
    });

    let validationId = 0;
    act(() => {
      validationId = handle.startValidation('user', 'username', 'unique');
    });

    expect(engine.pending_validation_count()).toBe(1);

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.resolveAsyncValidation(validationId, false, 'Username already taken');
    });

    expect(engine.pending_validation_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('validateJson returns boolean and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addRule('required', 0, '{}');
      handle.addSchema('user');
      handle.addSchemaField('user', 'email', '["required"]');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    let isValid = false;
    act(() => {
      isValid = handle.validateJson('user', '{"email":"test@example.com"}');
    });

    expect(isValid).toBe(true);
    expect(spy).toHaveBeenCalled();

    act(() => {
      isValid = handle.validateJson('user', '{"email":""}');
    });

    expect(isValid).toBe(false);
  });

  it('startValidation returns id and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addSchema('user');
      handle.addSchemaField('user', 'username', '[]');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    let id = 0;
    act(() => {
      id = handle.startValidation('user', 'username', 'unique');
    });

    expect(id).toBeGreaterThan(0);
    expect(engine.pending_validation_count()).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('reset calls engine.reset and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addRule('required', 0, '{}');
      handle.addSchema('user');
      handle.addSchemaField('user', 'email', '["required"]');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.reset();
    });

    expect(engine.rule_count()).toBe(0);
    expect(engine.schema_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('getValidationState reads all validation-level properties', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    const state = handle.getValidationState();
    expect(state).toEqual({
      ruleCount: 0,
      schemaCount: 0,
      pendingValidationCount: 0,
      dataVersion: 0,
    });

    act(() => {
      handle.addRule('required', 0, '{}');
      handle.addSchema('user');
    });

    const state2 = handle.getValidationState();
    expect(state2.ruleCount).toBe(1);
    expect(state2.schemaCount).toBe(1);
    expect(state2.dataVersion).toBeGreaterThan(0);
  });

  it('getSchemaValidation reads schema error state', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addRule('required', 0, '{}');
      handle.addSchema('user');
      handle.addSchemaField('user', 'email', '["required"]');
    });

    // Before validation — no errors
    const sv1 = handle.getSchemaValidation('user');
    expect(sv1.schemaId).toBe('user');
    expect(sv1.errorCount).toBe(0);
    expect(sv1.isValid).toBe(true);

    // After failing validation
    act(() => {
      handle.validateJson('user', '{"email":""}');
    });

    const sv2 = handle.getSchemaValidation('user');
    expect(sv2.errorCount).toBeGreaterThan(0);
    expect(sv2.isValid).toBe(false);
  });

  it('getFieldValidation reads per-field error state', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addRule('required', 0, '{}');
      handle.addSchema('user');
      handle.addSchemaField('user', 'email', '["required"]');
      handle.validateJson('user', '{"email":""}');
    });

    const fv = handle.getFieldValidation('user', 'email');
    expect(fv.schemaId).toBe('user');
    expect(fv.field).toBe('email');
    expect(fv.hasError).toBe(true);
    expect(fv.errorCount).toBe(1);
    expect(fv.firstError).toBe('email is required');
  });

  it('getFieldErrors reads field errors as JSON', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useValidationEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.addRule('required', 0, '{}');
      handle.addSchema('user');
      handle.addSchemaField('user', 'email', '["required"]');
      handle.validateJson('user', '{"email":""}');
    });

    const errorsJson = handle.getFieldErrors('user', 'email');
    const parsed = JSON.parse(errorsJson) as string[];
    expect(parsed.length).toBe(1);
    expect(parsed[0]).toBe('email is required');
  });
});
