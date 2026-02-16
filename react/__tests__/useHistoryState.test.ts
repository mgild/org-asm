import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHistoryState } from '../useHistoryState';
import { createNotifier } from '../useWasmState';
import type { IHistoryEngine } from '../../core/interfaces';
import type { HistoryHandle } from '../useHistoryEngine';
import type { HistoryState } from '../../core/types';

function createMockHistoryEngine(): IHistoryEngine {
  let version = 0;
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let checkpointIdx: number | null = null;
  let maxHist = 100;

  return {
    push_command(json: string) { undoStack.push(json); redoStack.length = 0; version++; },
    push_batch(json: string) { undoStack.push(json); redoStack.length = 0; version++; },
    undo() { if (undoStack.length === 0) return ''; const c = undoStack.pop()!; redoStack.push(c); version++; return c; },
    redo() { if (redoStack.length === 0) return ''; const c = redoStack.pop()!; undoStack.push(c); version++; return c; },
    can_undo() { return undoStack.length > 0; }, can_redo() { return redoStack.length > 0; },
    undo_count() { return undoStack.length; }, redo_count() { return redoStack.length; },
    undo_label() { return ''; }, redo_label() { return ''; },
    last_command() { return undoStack.length > 0 ? undoStack[undoStack.length - 1] : ''; },
    max_history() { return maxHist; }, set_max_history(m: number) { maxHist = m; version++; },
    checkpoint() { checkpointIdx = undoStack.length; version++; },
    is_at_checkpoint() { return checkpointIdx !== null && undoStack.length === checkpointIdx; },
    has_unsaved_changes() { return checkpointIdx !== null && undoStack.length !== checkpointIdx; },
    commands_since_checkpoint() { return checkpointIdx !== null ? Math.abs(undoStack.length - checkpointIdx) : 0; },
    clear_history() { undoStack.length = 0; checkpointIdx = null; version++; },
    clear_redo() { redoStack.length = 0; version++; },
    data_version() { return version; },
    reset() { undoStack.length = 0; redoStack.length = 0; checkpointIdx = null; maxHist = 100; version++; },
  };
}

function createHandle(engine: IHistoryEngine): HistoryHandle {
  const notifier = createNotifier();
  return {
    engine, notifier,
    pushCommand(json: string) { engine.push_command(json); notifier.notify(); },
    pushBatch(json: string) { engine.push_batch(json); notifier.notify(); },
    undo() { const r = engine.undo(); notifier.notify(); return r; },
    redo() { const r = engine.redo(); notifier.notify(); return r; },
    checkpoint() { engine.checkpoint(); notifier.notify(); },
    clearHistory() { engine.clear_history(); notifier.notify(); },
    clearRedo() { engine.clear_redo(); notifier.notify(); },
    setMaxHistory(m: number) { engine.set_max_history(m); notifier.notify(); },
    reset() { engine.reset(); notifier.notify(); },
    getHistoryState(): HistoryState { return { canUndo: engine.can_undo(), canRedo: engine.can_redo(), undoCount: engine.undo_count(), redoCount: engine.redo_count(), isAtCheckpoint: engine.is_at_checkpoint(), hasUnsavedChanges: engine.has_unsaved_changes(), commandsSinceCheckpoint: engine.commands_since_checkpoint(), maxHistory: engine.max_history(), dataVersion: engine.data_version() }; },
    lastCommand() { return engine.last_command(); },
    undoLabel(i: number) { return engine.undo_label(i); },
    redoLabel(i: number) { return engine.redo_label(i); },
  };
}

describe('useHistoryState', () => {
  it('returns empty HistoryState when handle is null', () => {
    const { result } = renderHook(() => useHistoryState(null));
    expect(result.current).toEqual({ canUndo: false, canRedo: false, undoCount: 0, redoCount: 0, isAtCheckpoint: true, hasUnsavedChanges: false, commandsSinceCheckpoint: 0, maxHistory: 100, dataVersion: 0 });
  });

  it('returns correct history state', () => {
    const engine = createMockHistoryEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useHistoryState(handle));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.maxHistory).toBe(100);
  });

  it('reflects changes after push and undo', () => {
    const engine = createMockHistoryEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useHistoryState(handle));
    act(() => { handle.pushCommand('{"label":"A"}'); });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.undoCount).toBe(1);
    act(() => { handle.undo(); });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.redoCount).toBe(1);
  });

  it('reflects checkpoint state', () => {
    const engine = createMockHistoryEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useHistoryState(handle));
    act(() => { handle.checkpoint(); });
    expect(result.current.isAtCheckpoint).toBe(true);
    act(() => { handle.pushCommand('{"label":"X"}'); });
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(result.current.commandsSinceCheckpoint).toBe(1);
  });

  it('updates on reset', () => {
    const engine = createMockHistoryEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useHistoryState(handle));
    act(() => { handle.pushCommand('{"label":"A"}'); handle.pushCommand('{"label":"B"}'); });
    act(() => { handle.reset(); });
    expect(result.current.undoCount).toBe(0);
    expect(result.current.canUndo).toBe(false);
  });
});
