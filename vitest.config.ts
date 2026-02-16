import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['**/__tests__/**/*.test.{ts,tsx}'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: [
        'react/useWasmCall.ts',
        'react/useWasmState.ts',
        'react/useWasmSelector.ts',
        'react/useAsyncWasmCall.ts',
        'react/useWasmStream.ts',
        'react/useWasmReducer.ts',
        'react/createWasmContext.ts',
        'react/useDebouncedWasmCall.ts',
        'react/WasmErrorBoundary.ts',
        'react/useFormEngine.ts',
        'react/useFormField.ts',
        'react/useFormState.ts',
        'react/createFormContext.ts',
        'react/useTableEngine.ts',
        'react/useTableRow.ts',
        'react/useTableCell.ts',
        'react/useTableState.ts',
        'react/createTableContext.ts',
        'controller/WasmTaskWorker.ts',
        'controller/task-worker-entry.ts',
        'core/types.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
