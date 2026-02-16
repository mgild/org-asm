/**
 * useTableCell — Per-cell subscription via useWasmSelector.
 *
 * Reads the edit overlay value, cell error, and dirty state for a single cell.
 * Only re-renders when this cell's editable state changes.
 *
 * Usage:
 *   const { value, error, dirty } = useTableCell(handle, 2, 'price');
 *   <input value={value} onChange={e => handle?.setEditValue(2, 'price', e.target.value)} />
 *   {error && <span className="error">{error}</span>}
 */

import { useWasmSelector } from './useWasmSelector';
import type { TableHandle } from './useTableEngine';
import type { CellState } from '../core/types';

const EMPTY_CELL: CellState = {
  value: '',
  error: '',
  dirty: false,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useTableCell(
  handle: TableHandle | null,
  rowIndex: number,
  column: string,
): CellState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_CELL;
      const { engine } = handle;
      return {
        value: engine.edit_value(rowIndex, column),
        error: engine.cell_error(rowIndex, column),
        dirty: engine.is_cell_dirty(rowIndex, column),
      };
    },
  );
}
