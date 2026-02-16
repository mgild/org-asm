import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createHistoryContext } from '../createHistoryContext';
import type { IHistoryEngine } from '../../core/interfaces';

function createMockHistoryEngine(): IHistoryEngine {
  let version = 0;
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let checkpointIdx: number | null = null;

  function extractLabel(json: string): string {
    const match = json.match(/"label"\s*:\s*"([^"]*)"/);
    return match ? match[1] : '';
  }

  return {
    push_command(json: string) { undoStack.push(json); redoStack.length = 0; version++; },
    push_batch(json: string) { undoStack.push(json); redoStack.length = 0; version++; },
    undo() { if (undoStack.length === 0) return ''; const c = undoStack.pop()!; redoStack.push(c); version++; return c; },
    redo() { if (redoStack.length === 0) return ''; const c = redoStack.pop()!; undoStack.push(c); version++; return c; },
    can_undo() { return undoStack.length > 0; }, can_redo() { return redoStack.length > 0; },
    undo_count() { return undoStack.length; }, redo_count() { return redoStack.length; },
    undo_label(index: number) { const idx = undoStack.length - 1 - index; return idx >= 0 ? extractLabel(undoStack[idx]) : ''; },
    redo_label(index: number) { const idx = redoStack.length - 1 - index; return idx >= 0 ? extractLabel(redoStack[idx]) : ''; },
    last_command() { return undoStack.length > 0 ? undoStack[undoStack.length - 1] : ''; },
    max_history() { return 100; }, set_max_history() { version++; },
    checkpoint() { checkpointIdx = undoStack.length; version++; },
    is_at_checkpoint() { return checkpointIdx !== null && undoStack.length === checkpointIdx; },
    has_unsaved_changes() { return checkpointIdx !== null && undoStack.length !== checkpointIdx; },
    commands_since_checkpoint() { return checkpointIdx !== null ? Math.abs(undoStack.length - checkpointIdx) : 0; },
    clear_history() { undoStack.length = 0; checkpointIdx = null; version++; },
    clear_redo() { redoStack.length = 0; version++; },
    data_version() { return version; },
    reset() { undoStack.length = 0; redoStack.length = 0; checkpointIdx = null; version++; },
  };
}

describe('createHistoryContext', () => {
  it('useHistory returns handle from provider', () => {
    const ctx = createHistoryContext<IHistoryEngine>();
    const engine = createMockHistoryEngine();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.HistoryProvider engine={engine}>{children}</ctx.HistoryProvider>
    );
    const { result } = renderHook(() => ctx.useHistory(), { wrapper });
    expect(result.current.engine).toBe(engine);
    expect(typeof result.current.pushCommand).toBe('function');
    expect(typeof result.current.undo).toBe('function');
  });

  it('useHistoryStatus returns state from provider', () => {
    const ctx = createHistoryContext<IHistoryEngine>();
    const engine = createMockHistoryEngine();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.HistoryProvider engine={engine}>{children}</ctx.HistoryProvider>
    );
    const { result } = renderHook(() => ctx.useHistoryStatus(), { wrapper });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.maxHistory).toBe(100);
  });

  it('useUndoItem returns entry from provider', () => {
    const ctx = createHistoryContext<IHistoryEngine>();
    const engine = createMockHistoryEngine();
    engine.push_command('{"label":"Test"}');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.HistoryProvider engine={engine}>{children}</ctx.HistoryProvider>
    );
    const { result } = renderHook(() => ctx.useUndoItem(0), { wrapper });
    expect(result.current).toEqual({ index: 0, label: 'Test' });
  });

  it('useRedoItem returns entry from provider', () => {
    const ctx = createHistoryContext<IHistoryEngine>();
    const engine = createMockHistoryEngine();
    engine.push_command('{"label":"Undone"}');
    engine.undo();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.HistoryProvider engine={engine}>{children}</ctx.HistoryProvider>
    );
    const { result } = renderHook(() => ctx.useRedoItem(0), { wrapper });
    expect(result.current).toEqual({ index: 0, label: 'Undone' });
  });

  it('useHistory throws outside provider', () => {
    const ctx = createHistoryContext<IHistoryEngine>();
    expect(() => { renderHook(() => ctx.useHistory()); }).toThrow('useHistory must be used within a HistoryProvider');
  });

  it('useHistoryStatus returns empty state outside provider', () => {
    const ctx = createHistoryContext<IHistoryEngine>();
    const { result } = renderHook(() => ctx.useHistoryStatus());
    expect(result.current.canUndo).toBe(false);
  });

  it('useUndoItem returns empty state outside provider', () => {
    const ctx = createHistoryContext<IHistoryEngine>();
    const { result } = renderHook(() => ctx.useUndoItem(0));
    expect(result.current).toEqual({ index: -1, label: '' });
  });

  it('useRedoItem returns empty state outside provider', () => {
    const ctx = createHistoryContext<IHistoryEngine>();
    const { result } = renderHook(() => ctx.useRedoItem(0));
    expect(result.current).toEqual({ index: -1, label: '' });
  });

  it('children render correctly', () => {
    const ctx = createHistoryContext<IHistoryEngine>();
    const engine = createMockHistoryEngine();
    const { container } = render(
      <ctx.HistoryProvider engine={engine}><div data-testid="child">Hello</div></ctx.HistoryProvider>,
    );
    expect(container.textContent).toBe('Hello');
  });

  it('HistoryProvider works with null engine', () => {
    const ctx = createHistoryContext<IHistoryEngine>();
    const { result } = renderHook(() => ctx.useUndoItem(0), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.HistoryProvider engine={null}>{children}</ctx.HistoryProvider>
      ),
    });
    expect(result.current).toEqual({ index: -1, label: '' });
  });

  it('mutations via useHistory propagate to useHistoryStatus and useUndoItem', () => {
    const ctx = createHistoryContext<IHistoryEngine>();
    const engine = createMockHistoryEngine();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.HistoryProvider engine={engine}>{children}</ctx.HistoryProvider>
    );
    const { result } = renderHook(
      () => ({ history: ctx.useHistory(), status: ctx.useHistoryStatus(), entry: ctx.useUndoItem(0) }),
      { wrapper },
    );
    expect(result.current.status.canUndo).toBe(false);
    act(() => { result.current.history.pushCommand('{"label":"Added"}'); });
    expect(result.current.status.canUndo).toBe(true);
    expect(result.current.status.undoCount).toBe(1);
    expect(result.current.entry.label).toBe('Added');
  });
});
