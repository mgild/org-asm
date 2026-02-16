import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useValidationState } from '../useValidationState';
import { createNotifier } from '../useWasmState';
import type { IValidationEngine } from '../../core/interfaces';
import type { ValidationHandle } from '../useValidationEngine';
import type { ValidationState, SchemaValidation, FieldValidation } from '../../core/types';

interface MockRule {
  ruleId: string;
  ruleType: number;
  paramsJson: string;
}

interface MockSchema {
  schemaId: string;
  fields: Map<string, string[]>;
}

interface MockPendingValidation {
  schemaId: string;
  field: string;
  ruleId: string;
}

function createMockEngine(): IValidationEngine {
  const rules: MockRule[] = [];
  const schemas: MockSchema[] = [];
  const errors = new Map<string, Map<string, string[]>>();
  const crossFieldRules: { schemaId: string; ruleType: number; fieldsJson: string; paramsJson: string }[] = [];
  const pendingValidations = new Map<number, MockPendingValidation>();
  let nextValidationId = 1;
  let version = 0;

  return {
    add_rule(ruleId: string, ruleType: number, paramsJson: string) { rules.push({ ruleId, ruleType, paramsJson }); version++; },
    remove_rule(ruleId: string) { const idx = rules.findIndex(r => r.ruleId === ruleId); if (idx >= 0) rules.splice(idx, 1); version++; },
    rule_count() { return rules.length; },
    rule_id(index: number) { return rules[index]?.ruleId ?? ''; },
    add_schema(schemaId: string) { schemas.push({ schemaId, fields: new Map() }); version++; },
    add_schema_field(schemaId: string, field: string, rulesJson: string) {
      const schema = schemas.find(s => s.schemaId === schemaId);
      if (schema) schema.fields.set(field, JSON.parse(rulesJson) as string[]);
      version++;
    },
    remove_schema(schemaId: string) { const idx = schemas.findIndex(s => s.schemaId === schemaId); if (idx >= 0) schemas.splice(idx, 1); version++; },
    schema_count() { return schemas.length; },
    schema_id(index: number) { return schemas[index]?.schemaId ?? ''; },
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
            if (rule && rule.ruleType === 0 && value === '') fieldErrors.push(`${field} is required`);
          }
          if (fieldErrors.length > 0) schemaErrors.set(field, fieldErrors);
        }
      }
      errors.set(schemaId, schemaErrors);
      version++;
      for (const errs of schemaErrors.values()) { if (errs.length > 0) return false; }
      return true;
    },
    clear_errors(schemaId: string) { errors.delete(schemaId); version++; },
    error_count(schemaId: string) {
      const se = errors.get(schemaId); if (!se) return 0;
      let c = 0; for (const e of se.values()) c += e.length; return c;
    },
    field_error_count(schemaId: string, field: string) { return errors.get(schemaId)?.get(field)?.length ?? 0; },
    field_error(schemaId: string, field: string, index: number) { return errors.get(schemaId)?.get(field)?.[index] ?? ''; },
    field_has_error(schemaId: string, field: string) { return (errors.get(schemaId)?.get(field)?.length ?? 0) > 0; },
    field_errors_json(schemaId: string, field: string) { return JSON.stringify(errors.get(schemaId)?.get(field) ?? []); },
    add_cross_field_rule(schemaId: string, ruleType: number, fieldsJson: string, paramsJson: string) { crossFieldRules.push({ schemaId, ruleType, fieldsJson, paramsJson }); version++; },
    cross_field_rule_count(schemaId: string) { return crossFieldRules.filter(r => r.schemaId === schemaId).length; },
    start_validation(schemaId: string, field: string, ruleId: string) { const id = nextValidationId++; pendingValidations.set(id, { schemaId, field, ruleId }); version++; return id; },
    resolve_async_validation(validationId: number, _isValid: boolean, _error: string) { pendingValidations.delete(validationId); version++; },
    pending_validation_count() { return pendingValidations.size; },
    pending_validation_schema(validationId: number) { return pendingValidations.get(validationId)?.schemaId ?? ''; },
    pending_validation_field(validationId: number) { return pendingValidations.get(validationId)?.field ?? ''; },
    data_version() { return version; },
    reset() { rules.length = 0; schemas.length = 0; errors.clear(); crossFieldRules.length = 0; pendingValidations.clear(); nextValidationId = 1; version++; },
  };
}

function createHandle(engine: IValidationEngine): ValidationHandle {
  const notifier = createNotifier();
  return {
    engine,
    notifier,
    addRule(ruleId: string, ruleType: number, paramsJson: string): void { engine.add_rule(ruleId, ruleType, paramsJson); notifier.notify(); },
    removeRule(ruleId: string): void { engine.remove_rule(ruleId); notifier.notify(); },
    addSchema(schemaId: string): void { engine.add_schema(schemaId); notifier.notify(); },
    addSchemaField(schemaId: string, field: string, rulesJson: string): void { engine.add_schema_field(schemaId, field, rulesJson); notifier.notify(); },
    removeSchema(schemaId: string): void { engine.remove_schema(schemaId); notifier.notify(); },
    clearErrors(schemaId: string): void { engine.clear_errors(schemaId); notifier.notify(); },
    addCrossFieldRule(schemaId: string, ruleType: number, fieldsJson: string, paramsJson: string): void { engine.add_cross_field_rule(schemaId, ruleType, fieldsJson, paramsJson); notifier.notify(); },
    resolveAsyncValidation(validationId: number, isValid: boolean, error: string): void { engine.resolve_async_validation(validationId, isValid, error); notifier.notify(); },
    reset(): void { engine.reset(); notifier.notify(); },
    validateJson(schemaId: string, dataJson: string): boolean { const r = engine.validate_json(schemaId, dataJson); notifier.notify(); return r; },
    startValidation(schemaId: string, field: string, ruleId: string): number { const id = engine.start_validation(schemaId, field, ruleId); notifier.notify(); return id; },
    getValidationState(): ValidationState {
      return {
        ruleCount: engine.rule_count(),
        schemaCount: engine.schema_count(),
        pendingValidationCount: engine.pending_validation_count(),
        dataVersion: engine.data_version(),
      };
    },
    getSchemaValidation(schemaId: string): SchemaValidation {
      return {
        schemaId,
        errorCount: engine.error_count(schemaId),
        isValid: engine.error_count(schemaId) === 0,
      };
    },
    getFieldValidation(schemaId: string, field: string): FieldValidation {
      return {
        schemaId,
        field,
        errorCount: engine.field_error_count(schemaId, field),
        hasError: engine.field_has_error(schemaId, field),
        firstError: engine.field_error(schemaId, field, 0),
      };
    },
    getFieldErrors(schemaId: string, field: string): string { return engine.field_errors_json(schemaId, field); },
  };
}

describe('useValidationState', () => {
  it('returns empty ValidationState when handle is null', () => {
    const { result } = renderHook(() => useValidationState(null));
    expect(result.current).toEqual({
      ruleCount: 0,
      schemaCount: 0,
      pendingValidationCount: 0,
      dataVersion: 0,
    });
  });

  it('returns correct validation state', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useValidationState(handle));

    expect(result.current).toEqual({
      ruleCount: 0,
      schemaCount: 0,
      pendingValidationCount: 0,
      dataVersion: 0,
    });
  });

  it('reflects ruleCount after addRule', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useValidationState(handle));
    expect(result.current.ruleCount).toBe(0);

    act(() => {
      handle.addRule('required', 0, '{}');
    });

    expect(result.current.ruleCount).toBe(1);
    expect(result.current.dataVersion).toBeGreaterThan(0);
  });

  it('reflects schemaCount after addSchema', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useValidationState(handle));
    expect(result.current.schemaCount).toBe(0);

    act(() => {
      handle.addSchema('user');
    });

    expect(result.current.schemaCount).toBe(1);
  });

  it('reflects pendingValidationCount after startValidation', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    act(() => {
      handle.addSchema('user');
      handle.addSchemaField('user', 'username', '[]');
    });

    const { result } = renderHook(() => useValidationState(handle));
    expect(result.current.pendingValidationCount).toBe(0);

    act(() => {
      handle.startValidation('user', 'username', 'unique');
    });

    expect(result.current.pendingValidationCount).toBe(1);
  });

  it('updates on notify', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useValidationState(handle));
    const initialVersion = result.current.dataVersion;

    act(() => {
      handle.addRule('required', 0, '{}');
    });

    expect(result.current.dataVersion).toBeGreaterThan(initialVersion);

    act(() => {
      handle.reset();
    });

    expect(result.current.ruleCount).toBe(0);
    expect(result.current.schemaCount).toBe(0);
    expect(result.current.pendingValidationCount).toBe(0);
  });
});
