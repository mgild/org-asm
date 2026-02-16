/**
 * useTableRow — Per-row subscription via useWasmSelector.
 *
 * Only this row's component re-renders when its selection state changes.
 * Other rows remain untouched thanks to structural equality.
 *
 * Usage:
 *   const { rowIndex, selected } = useTableRow(handle, 3);
 *   <tr className={selected ? 'selected' : ''}>...</tr>
 */

import { useWasmSelector } from './useWasmSelector';
import type { TableHandle } from './useTableEngine';
import type { RowState } from '../core/types';

const EMPTY_ROW: RowState = {
  rowIndex: -1,
  selected: false,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useTableRow(
  handle: TableHandle | null,
  rowIndex: number,
): RowState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_ROW;
      return {
        rowIndex,
        selected: handle.engine.is_row_selected(rowIndex),
      };
    },
  );
}
