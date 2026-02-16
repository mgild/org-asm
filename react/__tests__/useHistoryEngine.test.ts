import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHistoryEngine } from '../useHistoryEngine';
import type { IHistoryEngine } from '../../core/interfaces';

function createMockHistoryEngine(): IHistoryEngine {
  let version = 0;
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let checkpointIdx: number | null = null;
  let maxHist = 100;

  function extractLabel(json: string): string {
    const match = json.match(/"label"\s*:\s*"([^"]*)"/);
    return match ? match[1] : '';
  }

  return {
    push_command(json: string) { undoStack.push(json); redoStack.length = 0; version++; },
    push_batch(json: string) { undoStack.push(json); redoStack.length = 0; version++; },
    undo() { if (undoStack.length === 0) return ''; const cmd = undoStack.pop()!; redoStack.push(cmd); version++; return cmd; },
    redo() { if (redoStack.length === 0) return ''; const cmd = redoStack.pop()!; undoStack.push(cmd); version++; return cmd; },
    can_undo() { return undoStack.length > 0; },
    can_redo() { return redoStack.length > 0; },
    undo_count() { return undoStack.length; },
    redo_count() { return redoStack.length; },
    undo_label(index: number) { const idx = undoStack.length - 1 - index; return idx >= 0 ? extractLabel(undoStack[idx]) : ''; },
    redo_label(index: number) { const idx = redoStack.length - 1 - index; return idx >= 0 ? extractLabel(redoStack[idx]) : ''; },
    last_command() { return undoStack.length > 0 ? undoStack[undoStack.length - 1] : ''; },
    max_history() { return maxHist; },
    set_max_history(max: number) { maxHist = max; version++; },
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

describe('useHistoryEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useHistoryEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns HistoryHandle with all methods', () => {
    const engine = createMockHistoryEngine();
    const { result } = renderHook(() => useHistoryEngine(engine));
    const handle = result.current!;
    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.pushCommand).toBe('function');
    expect(typeof handle.pushBatch).toBe('function');
    expect(typeof handle.undo).toBe('function');
    expect(typeof handle.redo).toBe('function');
    expect(typeof handle.checkpoint).toBe('function');
    expect(typeof handle.clearHistory).toBe('function');
    expect(typeof handle.clearRedo).toBe('function');
    expect(typeof handle.setMaxHistory).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getHistoryState).toBe('function');
    expect(typeof handle.lastCommand).toBe('function');
    expect(typeof handle.undoLabel).toBe('function');
    expect(typeof handle.redoLabel).toBe('function');
  });

  it('pushCommand adds to undo stack and notifies', () => {
    const engine = createMockHistoryEngine();
    const { result } = renderHook(() => useHistoryEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.pushCommand('{"label":"Set name","field":"name","prev":"A","next":"B"}'); });
    expect(engine.can_undo()).toBe(true);
    expect(engine.undo_count()).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('pushBatch adds to undo stack and notifies', () => {
    const engine = createMockHistoryEngine();
    const { result } = renderHook(() => useHistoryEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.pushBatch('{"label":"Batch","commands":[]}'); });
    expect(engine.undo_count()).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('undo/redo move between stacks and return JSON', () => {
    const engine = createMockHistoryEngine();
    const { result } = renderHook(() => useHistoryEngine(engine));
    const handle = result.current!;
    const cmd = '{"label":"Change","field":"x"}';
    act(() => { handle.pushCommand(cmd); });
    let undone: string = '';
    act(() => { undone = handle.undo(); });
    expect(undone).toBe(cmd);
    expect(engine.can_undo()).toBe(false);
    expect(engine.can_redo()).toBe(true);
    let redone: string = '';
    act(() => { redone = handle.redo(); });
    expect(redone).toBe(cmd);
    expect(engine.can_undo()).toBe(true);
    expect(engine.can_redo()).toBe(false);
  });

  it('undo returns empty string when stack is empty', () => {
    const engine = createMockHistoryEngine();
    const { result } = renderHook(() => useHistoryEngine(engine));
    const handle = result.current!;
    let undone: string = '';
    act(() => { undone = handle.undo(); });
    expect(undone).toBe('');
  });

  it('checkpoint and unsaved changes tracking', () => {
    const engine = createMockHistoryEngine();
    const { result } = renderHook(() => useHistoryEngine(engine));
    const handle = result.current!;
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.checkpoint(); });
    expect(engine.is_at_checkpoint()).toBe(true);
    expect(engine.has_unsaved_changes()).toBe(false);
    act(() => { handle.pushCommand('{"label":"X"}'); });
    expect(engine.has_unsaved_changes()).toBe(true);
    expect(engine.commands_since_checkpoint()).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('clearHistory/clearRedo/setMaxHistory and notify', () => {
    const engine = createMockHistoryEngine();
    const { result } = renderHook(() => useHistoryEngine(engine));
    const handle = result.current!;
    act(() => { handle.pushCommand('{"label":"A"}'); handle.pushCommand('{"label":"B"}'); });
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.clearHistory(); });
    expect(engine.undo_count()).toBe(0);
    act(() => { handle.pushCommand('{"label":"C"}'); handle.undo(); });
    act(() => { handle.clearRedo(); });
    expect(engine.redo_count()).toBe(0);
    act(() => { handle.setMaxHistory(50); });
    expect(engine.max_history()).toBe(50);
    expect(spy).toHaveBeenCalled();
  });

  it('reset calls engine and notifies', () => {
    const engine = createMockHistoryEngine();
    const { result } = renderHook(() => useHistoryEngine(engine));
    const handle = result.current!;
    act(() => { handle.pushCommand('{"label":"A"}'); });
    const spy = vi.fn();
    handle.notifier.subscribe(spy);
    act(() => { handle.reset(); });
    expect(engine.undo_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('getHistoryState reads all properties', () => {
    const engine = createMockHistoryEngine();
    const { result } = renderHook(() => useHistoryEngine(engine));
    const handle = result.current!;
    const state = handle.getHistoryState();
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
    expect(state.undoCount).toBe(0);
    expect(state.maxHistory).toBe(100);
    expect(state.isAtCheckpoint).toBe(false);
  });

  it('lastCommand/undoLabel/redoLabel read from engine', () => {
    const engine = createMockHistoryEngine();
    const { result } = renderHook(() => useHistoryEngine(engine));
    const handle = result.current!;
    act(() => { handle.pushCommand('{"label":"Set name"}'); });
    expect(handle.lastCommand()).toBe('{"label":"Set name"}');
    expect(handle.undoLabel(0)).toBe('Set name');
    act(() => { handle.undo(); });
    expect(handle.redoLabel(0)).toBe('Set name');
  });
});
