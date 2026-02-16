/**
 * createTableContext — Context factory for sharing a TableHandle across
 * a component tree without prop drilling.
 *
 * Mirrors the createFormContext pattern: create once per table engine type,
 * wrap at the root, read from any descendant.
 *
 * Usage:
 *   // context.ts
 *   export const { TableProvider, useTable, useRow, useCell, useTableStatus } = createTableContext<MyTableEngine>();
 *
 *   // App.tsx
 *   <TableProvider engine={engine} wasmMemory={memory}>
 *     <MyTable />
 *   </TableProvider>
 *
 *   // Any descendant
 *   const { toggleSort, setPage } = useTable();
 *   const { selected } = useRow(3);
 *   const { value, error } = useCell(3, 'price');
 *   const { page, pageCount } = useTableStatus();
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useTableEngine } from './useTableEngine';
import { useTableRow } from './useTableRow';
import { useTableCell } from './useTableCell';
import { useTableState } from './useTableState';
import type { TableHandle } from './useTableEngine';
import type { ITableEngine } from '../core/interfaces';
import type { RowState, CellState, TableState } from '../core/types';

export interface TableProviderProps<E extends ITableEngine> {
  engine: E | null;
  wasmMemory?: WebAssembly.Memory | null;
  children: ReactNode;
}

export interface TableContextValue<E extends ITableEngine> {
  TableProvider: (props: TableProviderProps<E>) => ReactNode;
  useTable: () => TableHandle<E>;
  useRow: (rowIndex: number) => RowState;
  useCell: (rowIndex: number, column: string) => CellState;
  useTableStatus: () => TableState;
}

export function createTableContext<E extends ITableEngine>(): TableContextValue<E> {
  const HandleCtx = createContext<TableHandle<E> | null>(null);

  function useTable(): TableHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useTable must be used within a TableProvider');
    }
    return ctx;
  }

  function useRow(rowIndex: number): RowState {
    const ctx = useContext(HandleCtx);
    return useTableRow(ctx, rowIndex);
  }

  function useCell(rowIndex: number, column: string): CellState {
    const ctx = useContext(HandleCtx);
    return useTableCell(ctx, rowIndex, column);
  }

  function useTableStatus(): TableState {
    const ctx = useContext(HandleCtx);
    return useTableState(ctx);
  }

  function TableProvider({ engine, wasmMemory, children }: TableProviderProps<E>): ReactNode {
    const handle = useTableEngine(engine, wasmMemory);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { TableProvider, useTable, useRow, useCell, useTableStatus };
}
