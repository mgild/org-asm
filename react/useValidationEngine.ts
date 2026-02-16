/**
 * useValidationEngine — Creates a ValidationHandle wrapping a Rust IValidationEngine.
 *
 * The handle provides dispatch functions (addRule, removeRule, addSchema, etc.)
 * that mutate the engine and notify subscribers. Per-field and validation-level
 * hooks (useFieldValidation, useValidationState) subscribe via the notifier.
 *
 * Usage:
 *   const engine = useMemo(() => new MyValidationEngine(), []);
 *   const handle = useValidationEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.addRule('required', 0, '{}');
 *   handle.addSchema('user');
 *   handle.addSchemaField('user', 'email', '["required"]');
 *   const isValid = handle.validateJson('user', '{"email":"test@example.com"}');
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { IValidationEngine } from '../core/interfaces';
import type { ValidationState, SchemaValidation, FieldValidation } from '../core/types';

export interface ValidationHandle<E extends IValidationEngine = IValidationEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;

  // Dispatch functions (mutate engine + notify)
  addRule(ruleId: string, ruleType: number, paramsJson: string): void;
  removeRule(ruleId: string): void;
  addSchema(schemaId: string): void;
  addSchemaField(schemaId: string, field: string, rulesJson: string): void;
  removeSchema(schemaId: string): void;
  clearErrors(schemaId: string): void;
  addCrossFieldRule(schemaId: string, ruleType: number, fieldsJson: string, paramsJson: string): void;
  resolveAsyncValidation(validationId: number, isValid: boolean, error: string): void;
  reset(): void;

  // Special dispatch (mutate engine + notify + return value)
  validateJson(schemaId: string, dataJson: string): boolean;
  startValidation(schemaId: string, field: string, ruleId: string): number;

  // Reads (no notify)
  getValidationState(): ValidationState;
  getSchemaValidation(schemaId: string): SchemaValidation;
  getFieldValidation(schemaId: string, field: string): FieldValidation;
  getFieldErrors(schemaId: string, field: string): string;
}

export function useValidationEngine<E extends IValidationEngine>(
  engine: E | null,
): ValidationHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

    return {
      engine,
      notifier,

      addRule(ruleId: string, ruleType: number, paramsJson: string): void {
        engine.add_rule(ruleId, ruleType, paramsJson);
        notifier.notify();
      },
      removeRule(ruleId: string): void {
        engine.remove_rule(ruleId);
        notifier.notify();
      },
      addSchema(schemaId: string): void {
        engine.add_schema(schemaId);
        notifier.notify();
      },
      addSchemaField(schemaId: string, field: string, rulesJson: string): void {
        engine.add_schema_field(schemaId, field, rulesJson);
        notifier.notify();
      },
      removeSchema(schemaId: string): void {
        engine.remove_schema(schemaId);
        notifier.notify();
      },
      clearErrors(schemaId: string): void {
        engine.clear_errors(schemaId);
        notifier.notify();
      },
      addCrossFieldRule(schemaId: string, ruleType: number, fieldsJson: string, paramsJson: string): void {
        engine.add_cross_field_rule(schemaId, ruleType, fieldsJson, paramsJson);
        notifier.notify();
      },
      resolveAsyncValidation(validationId: number, isValid: boolean, error: string): void {
        engine.resolve_async_validation(validationId, isValid, error);
        notifier.notify();
      },
      reset(): void {
        engine.reset();
        notifier.notify();
      },

      validateJson(schemaId: string, dataJson: string): boolean {
        const result = engine.validate_json(schemaId, dataJson);
        notifier.notify();
        return result;
      },
      startValidation(schemaId: string, field: string, ruleId: string): number {
        const id = engine.start_validation(schemaId, field, ruleId);
        notifier.notify();
        return id;
      },

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
      getFieldErrors(schemaId: string, field: string): string {
        return engine.field_errors_json(schemaId, field);
      },
    };
  }, [engine, notifier]);
}
