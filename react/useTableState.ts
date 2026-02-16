/**
 * useTableState — Table-level state subscription.
 *
 * For pagination controls, sort headers, toolbar indicators, and edit status.
 * Re-renders only when table-level state changes (page, sort, filter, etc.).
 *
 * Usage:
 *   const { page, pageCount, sortColumn, sortDirection, hasEdits } = useTableState(handle);
 *   <button disabled={page === 0} onClick={() => handle?.setPage(page - 1)}>Prev</button>
 */

import { useWasmSelector } from './useWasmSelector';
import type { TableHandle } from './useTableEngine';
import type { TableState } from '../core/types';
import { SortDirection } from '../core/types';

const EMPTY_STATE: TableState = {
  page: 0,
  pageSize: 0,
  pageCount: 0,
  totalRowCount: 0,
  rowCount: 0,
  sortColumn: '',
  sortDirection: SortDirection.None,
  selectedCount: 0,
  allSelected: false,
  hasEdits: false,
  isEditable: false,
  needsFetch: false,
  groupByColumn: '',
  groupCount: 0,
  dataVersion: 0,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useTableState(
  handle: TableHandle | null,
): TableState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
      return {
        page: engine.page(),
        pageSize: engine.page_size(),
        pageCount: engine.page_count(),
        totalRowCount: engine.total_row_count(),
        rowCount: engine.row_count(),
        sortColumn: engine.sort_column(),
        sortDirection: engine.sort_direction(),
        selectedCount: engine.selected_count(),
        allSelected: engine.all_selected(),
        hasEdits: engine.has_edits(),
        isEditable: engine.is_editable(),
        needsFetch: engine.needs_fetch(),
        groupByColumn: engine.group_by_column(),
        groupCount: engine.group_count(),
        dataVersion: engine.data_version(),
      };
    },
  );
}
