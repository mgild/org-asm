import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createValidationContext } from '../createValidationContext';
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

describe('createValidationContext', () => {
  it('useValidation returns handle from provider', () => {
    const ctx = createValidationContext<IValidationEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.ValidationProvider engine={engine}>
        {children}
      </ctx.ValidationProvider>
    );

    const { result } = renderHook(() => ctx.useValidation(), { wrapper });
    const handle = result.current;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
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

  it('useFieldValidation returns field state from provider', () => {
    const ctx = createValidationContext<IValidationEngine>();
    const engine = createMockEngine();
    engine.add_rule('required', 0, '{}');
    engine.add_schema('user');
    engine.add_schema_field('user', 'email', '["required"]');
    engine.validate_json('user', '{"email":""}');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.ValidationProvider engine={engine}>
        {children}
      </ctx.ValidationProvider>
    );

    const { result } = renderHook(() => ctx.useFieldValidation('user', 'email'), { wrapper });

    expect(result.current.schemaId).toBe('user');
    expect(result.current.field).toBe('email');
    expect(result.current.hasError).toBe(true);
    expect(result.current.errorCount).toBe(1);
    expect(result.current.firstError).toBe('email is required');
  });

  it('useValidationStatus returns validation state from provider', () => {
    const ctx = createValidationContext<IValidationEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.ValidationProvider engine={engine}>
        {children}
      </ctx.ValidationProvider>
    );

    const { result } = renderHook(() => ctx.useValidationStatus(), { wrapper });

    expect(result.current).toEqual({
      ruleCount: 0,
      schemaCount: 0,
      pendingValidationCount: 0,
      dataVersion: 0,
    });
  });

  it('useValidation throws outside provider', () => {
    const ctx = createValidationContext<IValidationEngine>();

    expect(() => {
      renderHook(() => ctx.useValidation());
    }).toThrow('useValidation must be used within a ValidationProvider');
  });

  it('useFieldValidation returns empty state outside provider (null handle)', () => {
    const ctx = createValidationContext<IValidationEngine>();

    const { result } = renderHook(() => ctx.useFieldValidation('user', 'email'));

    expect(result.current).toEqual({
      schemaId: '',
      field: '',
      errorCount: 0,
      hasError: false,
      firstError: '',
    });
  });

  it('useValidationStatus returns empty state outside provider (null handle)', () => {
    const ctx = createValidationContext<IValidationEngine>();

    const { result } = renderHook(() => ctx.useValidationStatus());

    expect(result.current).toEqual({
      ruleCount: 0,
      schemaCount: 0,
      pendingValidationCount: 0,
      dataVersion: 0,
    });
  });

  it('children render correctly', () => {
    const ctx = createValidationContext<IValidationEngine>();
    const engine = createMockEngine();

    const { container } = render(
      <ctx.ValidationProvider engine={engine}>
        <div data-testid="child">Hello from child</div>
      </ctx.ValidationProvider>,
    );

    expect(container.textContent).toBe('Hello from child');
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('ValidationProvider works with null engine', () => {
    const ctx = createValidationContext<IValidationEngine>();

    const { result } = renderHook(() => ctx.useFieldValidation('user', 'email'), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.ValidationProvider engine={null}>
          {children}
        </ctx.ValidationProvider>
      ),
    });

    expect(result.current).toEqual({
      schemaId: '',
      field: '',
      errorCount: 0,
      hasError: false,
      firstError: '',
    });
  });

  it('mutations via useValidation propagate to useFieldValidation and useValidationStatus', () => {
    const ctx = createValidationContext<IValidationEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.ValidationProvider engine={engine}>
        {children}
      </ctx.ValidationProvider>
    );

    const { result } = renderHook(
      () => ({
        validation: ctx.useValidation(),
        fieldValidation: ctx.useFieldValidation('user', 'email'),
        status: ctx.useValidationStatus(),
      }),
      { wrapper },
    );

    expect(result.current.fieldValidation.hasError).toBe(false);
    expect(result.current.status.ruleCount).toBe(0);
    expect(result.current.status.schemaCount).toBe(0);

    act(() => {
      result.current.validation.addRule('required', 0, '{}');
      result.current.validation.addSchema('user');
      result.current.validation.addSchemaField('user', 'email', '["required"]');
    });

    expect(result.current.status.ruleCount).toBe(1);
    expect(result.current.status.schemaCount).toBe(1);

    act(() => {
      result.current.validation.validateJson('user', '{"email":""}');
    });

    expect(result.current.fieldValidation.hasError).toBe(true);
    expect(result.current.fieldValidation.firstError).toBe('email is required');

    act(() => {
      result.current.validation.validateJson('user', '{"email":"test@example.com"}');
    });

    expect(result.current.fieldValidation.hasError).toBe(false);
    expect(result.current.fieldValidation.firstError).toBe('');
  });
});
