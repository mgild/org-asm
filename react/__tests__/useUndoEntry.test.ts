import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoEntry } from '../useUndoEntry';
import { createNotifier } from '../useWasmState';
import type { IHistoryEngine } from '../../core/interfaces';
import type { HistoryHandle } from '../useHistoryEngine';
import type { HistoryState } from '../../core/types';

function createMockHistoryEngine(): IHistoryEngine {
  let version = 0;
  const undoStack: string[] = [];
  const redoStack: string[] = [];

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
    last_command() { return ''; },
    max_history() { return 100; }, set_max_history() { version++; },
    checkpoint() { version++; }, is_at_checkpoint() { return false; }, has_unsaved_changes() { return false; },
    commands_since_checkpoint() { return 0; },
    clear_history() { undoStack.length = 0; version++; }, clear_redo() { redoStack.length = 0; version++; },
    data_version() { return version; },
    reset() { undoStack.length = 0; redoStack.length = 0; version++; },
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
    getHistoryState(): HistoryState { return { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0, isAtCheckpoint: false, hasUnsavedChanges: false, commandsSinceCheckpoint: 0, maxHistory: 100, dataVersion: 0 }; },
    lastCommand() { return engine.last_command(); },
    undoLabel(i: number) { return engine.undo_label(i); },
    redoLabel(i: number) { return engine.redo_label(i); },
  };
}

describe('useUndoEntry', () => {
  it('returns empty entry when handle is null', () => {
    const { result } = renderHook(() => useUndoEntry(null, 0));
    expect(result.current).toEqual({ index: -1, label: '' });
  });

  it('returns correct undo entry label', () => {
    const engine = createMockHistoryEngine();
    engine.push_command('{"label":"Set name"}');
    engine.push_command('{"label":"Set email"}');
    const handle = createHandle(engine);
    const { result } = renderHook(() => useUndoEntry(handle, 0));
    expect(result.current).toEqual({ index: 0, label: 'Set email' });
  });

  it('returns second entry', () => {
    const engine = createMockHistoryEngine();
    engine.push_command('{"label":"First"}');
    engine.push_command('{"label":"Second"}');
    const handle = createHandle(engine);
    const { result } = renderHook(() => useUndoEntry(handle, 1));
    expect(result.current).toEqual({ index: 1, label: 'First' });
  });

  it('updates on notify', () => {
    const engine = createMockHistoryEngine();
    const handle = createHandle(engine);
    const { result } = renderHook(() => useUndoEntry(handle, 0));
    expect(result.current.label).toBe('');
    act(() => { handle.pushCommand('{"label":"New"}'); });
    expect(result.current.label).toBe('New');
  });
});
