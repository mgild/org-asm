import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommandPaletteState } from '../useCommandPaletteState';
import { createNotifier } from '../useWasmState';
import type { ICommandPaletteEngine } from '../../core/interfaces';
import type { CommandPaletteHandle } from '../useCommandPaletteEngine';
import type { CommandPaletteState } from '../../core/types';

interface CommandEntry {
  id: string;
  label: string;
  category: string;
  keybinding: string;
  enabled: boolean;
}

function createMockEngine(): ICommandPaletteEngine {
  const commands: CommandEntry[] = [];
  const keybindings = new Map<string, string>();
  const executionCounts = new Map<string, number>();
  let query = '';
  let lastExecutedId = '';
  let page = 0;
  let pageSize = 50;
  let version = 0;

  function getResults(): number[] {
    const results: number[] = [];
    for (let i = 0; i < commands.length; i++) {
      if (commands[i].enabled) results.push(i);
    }
    return results;
  }

  return {
    register_command(id: string, label: string, category: string, keybinding: string) {
      commands.push({ id, label, category, keybinding, enabled: true });
      if (keybinding) keybindings.set(keybinding.toLowerCase(), id);
      version++;
    },
    unregister_command(id: string) {
      const idx = commands.findIndex(c => c.id === id);
      if (idx >= 0) { commands.splice(idx, 1); version++; }
    },
    command_count() { return commands.length; },
    command_id(index: number) { return commands[index]?.id ?? ''; },
    command_label(id: string) { return commands.find(c => c.id === id)?.label ?? ''; },
    command_category(id: string) { return commands.find(c => c.id === id)?.category ?? ''; },
    set_enabled(id: string, enabled: boolean) {
      const cmd = commands.find(c => c.id === id);
      if (cmd) { cmd.enabled = enabled; version++; }
    },
    is_enabled(id: string) { return commands.find(c => c.id === id)?.enabled ?? false; },
    set_query(text: string) { query = text; page = 0; version++; },
    query() { return query; },
    result_count() { return getResults().length; },
    result_id(index: number) {
      const results = getResults();
      const gi = page * pageSize + index;
      return gi < results.length ? commands[results[gi]].id : '';
    },
    result_label(index: number) {
      const results = getResults();
      const gi = page * pageSize + index;
      return gi < results.length ? commands[results[gi]].label : '';
    },
    result_category(index: number) {
      const results = getResults();
      const gi = page * pageSize + index;
      return gi < results.length ? commands[results[gi]].category : '';
    },
    result_score(_index: number) { return 1.0; },
    resolve_keybinding(keyCombo: string) { return keybindings.get(keyCombo.toLowerCase()) ?? ''; },
    keybinding(commandId: string) { return commands.find(c => c.id === commandId)?.keybinding ?? ''; },
    set_keybinding(commandId: string, kb: string) {
      const cmd = commands.find(c => c.id === commandId);
      if (cmd) { cmd.keybinding = kb; version++; }
    },
    mark_executed(id: string) {
      executionCounts.set(id, (executionCounts.get(id) ?? 0) + 1);
      lastExecutedId = id;
      version++;
    },
    last_executed_id() { return lastExecutedId; },
    execution_count(id: string) { return executionCounts.get(id) ?? 0; },
    set_page(p: number) { page = p; version++; },
    set_page_size(s: number) { pageSize = s === 0 ? 50 : s; page = 0; version++; },
    page() { return page; },
    page_size() { return pageSize; },
    page_count() {
      const total = getResults().length;
      return total === 0 ? 0 : Math.ceil(total / pageSize);
    },
    data_version() { return version; },
    reset() {
      commands.length = 0; keybindings.clear(); executionCounts.clear();
      query = ''; lastExecutedId = ''; page = 0; pageSize = 50; version++;
    },
  };
}

function createHandle(engine: ICommandPaletteEngine): CommandPaletteHandle {
  const notifier = createNotifier();
  return {
    engine,
    notifier,
    registerCommand(id: string, label: string, category: string, keybinding: string): void { engine.register_command(id, label, category, keybinding); notifier.notify(); },
    unregisterCommand(id: string): void { engine.unregister_command(id); notifier.notify(); },
    setEnabled(id: string, enabled: boolean): void { engine.set_enabled(id, enabled); notifier.notify(); },
    setQuery(text: string): void { engine.set_query(text); notifier.notify(); },
    setKeybinding(commandId: string, keybinding: string): void { engine.set_keybinding(commandId, keybinding); notifier.notify(); },
    markExecuted(id: string): void { engine.mark_executed(id); notifier.notify(); },
    setPage(page: number): void { engine.set_page(page); notifier.notify(); },
    setPageSize(size: number): void { engine.set_page_size(size); notifier.notify(); },
    reset(): void { engine.reset(); notifier.notify(); },
    getCommandPaletteState(): CommandPaletteState {
      return {
        commandCount: engine.command_count(),
        query: engine.query(),
        resultCount: engine.result_count(),
        page: engine.page(),
        pageSize: engine.page_size(),
        pageCount: engine.page_count(),
        lastExecutedId: engine.last_executed_id(),
        dataVersion: engine.data_version(),
      };
    },
    resolveKeybinding(keyCombo: string): string { return engine.resolve_keybinding(keyCombo); },
    getKeybinding(commandId: string): string { return engine.keybinding(commandId); },
    getExecutionCount(id: string): number { return engine.execution_count(id); },
    isEnabled(id: string): boolean { return engine.is_enabled(id); },
  };
}

describe('useCommandPaletteState', () => {
  it('returns empty CommandPaletteState when handle is null', () => {
    const { result } = renderHook(() => useCommandPaletteState(null));
    expect(result.current).toEqual({
      commandCount: 0,
      query: '',
      resultCount: 0,
      page: 0,
      pageSize: 50,
      pageCount: 0,
      lastExecutedId: '',
      dataVersion: 0,
    });
  });

  it('returns correct command palette state', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useCommandPaletteState(handle));

    expect(result.current).toEqual({
      commandCount: 0,
      query: '',
      resultCount: 0,
      page: 0,
      pageSize: 50,
      pageCount: 0,
      lastExecutedId: '',
      dataVersion: 0,
    });
  });

  it('reflects commandCount after registerCommand', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useCommandPaletteState(handle));
    expect(result.current.commandCount).toBe(0);

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', 'Ctrl+O');
      handle.registerCommand('file.save', 'Save File', 'File', 'Ctrl+S');
    });

    expect(result.current.commandCount).toBe(2);
    expect(result.current.resultCount).toBe(2);
  });

  it('reflects query after setQuery', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useCommandPaletteState(handle));
    expect(result.current.query).toBe('');

    act(() => {
      handle.setQuery('open');
    });

    expect(result.current.query).toBe('open');
    expect(result.current.dataVersion).toBeGreaterThan(0);
  });

  it('reflects page after setPage', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useCommandPaletteState(handle));
    expect(result.current.page).toBe(0);

    act(() => {
      handle.setPage(3);
    });

    expect(result.current.page).toBe(3);
  });

  it('reflects lastExecutedId after markExecuted', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useCommandPaletteState(handle));

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', '');
      handle.markExecuted('file.open');
    });

    expect(result.current.lastExecutedId).toBe('file.open');
  });

  it('updates on notify', () => {
    const engine = createMockEngine();
    const handle = createHandle(engine);

    const { result } = renderHook(() => useCommandPaletteState(handle));
    const initialVersion = result.current.dataVersion;

    act(() => {
      handle.setQuery('test');
    });

    expect(result.current.dataVersion).toBeGreaterThan(initialVersion);

    act(() => {
      handle.reset();
    });

    expect(result.current.query).toBe('');
    expect(result.current.commandCount).toBe(0);
    expect(result.current.lastExecutedId).toBe('');
  });
});
