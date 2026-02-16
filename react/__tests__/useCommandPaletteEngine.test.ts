import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommandPaletteEngine } from '../useCommandPaletteEngine';
import type { ICommandPaletteEngine } from '../../core/interfaces';

interface CommandEntry {
  id: string;
  label: string;
  category: string;
  keybinding: string;
  enabled: boolean;
}

function createMockEngine(): ICommandPaletteEngine & {
  _commands: CommandEntry[];
  _query: string;
  _page: number;
  _pageSize: number;
} {
  const commands: CommandEntry[] = [];
  const keybindings = new Map<string, string>(); // normalized combo -> command id
  const executionCounts = new Map<string, number>();
  let query = '';
  let lastExecutedId = '';
  let page = 0;
  let pageSize = 50;
  let version = 0;

  function normalizeCombo(combo: string): string {
    const parts = combo.toLowerCase().split('+').map(p => p.trim());
    const modifiers: string[] = [];
    const keys: string[] = [];
    for (const part of parts) {
      const mapped = part === 'cmd' ? 'meta' : part === 'ctrl' ? 'control' : part;
      if (['alt', 'meta', 'control', 'shift'].includes(mapped)) {
        modifiers.push(mapped);
      } else {
        keys.push(mapped);
      }
    }
    modifiers.sort();
    return [...modifiers, ...keys].join('+');
  }

  function fuzzyMatch(text: string, pattern: string): number {
    if (pattern === '') return 1.0;
    const lower = text.toLowerCase();
    const pLower = pattern.toLowerCase();
    let pi = 0;
    let gaps = 0;
    for (let i = 0; i < lower.length && pi < pLower.length; i++) {
      if (lower[i] === pLower[pi]) {
        pi++;
      } else if (pi > 0) {
        gaps++;
      }
    }
    if (pi < pLower.length) return 0;
    return (pi / pLower.length) - (gaps * 0.01);
  }

  function getResults(): { index: number; score: number }[] {
    const results: { index: number; score: number }[] = [];
    for (let i = 0; i < commands.length; i++) {
      if (!commands[i].enabled) continue;
      const score = fuzzyMatch(commands[i].label, query);
      if (query === '' || score > 0) {
        const recencyBoost = Math.min((executionCounts.get(commands[i].id) ?? 0) * 0.1, 1.0);
        results.push({ index: i, score: score + recencyBoost });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  return {
    _commands: commands,
    _query: query,
    _page: page,
    _pageSize: pageSize,

    register_command(id: string, label: string, category: string, keybinding: string) {
      commands.push({ id, label, category, keybinding, enabled: true });
      if (keybinding) {
        keybindings.set(normalizeCombo(keybinding), id);
      }
      version++;
    },
    unregister_command(id: string) {
      const idx = commands.findIndex(c => c.id === id);
      if (idx >= 0) {
        const cmd = commands[idx];
        if (cmd.keybinding) {
          keybindings.delete(normalizeCombo(cmd.keybinding));
        }
        commands.splice(idx, 1);
        version++;
      }
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

    set_query(text: string) {
      query = text;
      (this as ReturnType<typeof createMockEngine>)._query = text;
      page = 0;
      (this as ReturnType<typeof createMockEngine>)._page = 0;
      version++;
    },
    query() { return query; },
    result_count() { return getResults().length; },
    result_id(index: number) {
      const results = getResults();
      const globalIdx = page * pageSize + index;
      if (globalIdx >= results.length) return '';
      return commands[results[globalIdx].index].id;
    },
    result_label(index: number) {
      const results = getResults();
      const globalIdx = page * pageSize + index;
      if (globalIdx >= results.length) return '';
      return commands[results[globalIdx].index].label;
    },
    result_category(index: number) {
      const results = getResults();
      const globalIdx = page * pageSize + index;
      if (globalIdx >= results.length) return '';
      return commands[results[globalIdx].index].category;
    },
    result_score(index: number) {
      const results = getResults();
      const globalIdx = page * pageSize + index;
      if (globalIdx >= results.length) return 0;
      return results[globalIdx].score;
    },

    resolve_keybinding(keyCombo: string) {
      return keybindings.get(normalizeCombo(keyCombo)) ?? '';
    },
    keybinding(commandId: string) {
      return commands.find(c => c.id === commandId)?.keybinding ?? '';
    },
    set_keybinding(commandId: string, kb: string) {
      const cmd = commands.find(c => c.id === commandId);
      if (cmd) {
        if (cmd.keybinding) {
          keybindings.delete(normalizeCombo(cmd.keybinding));
        }
        cmd.keybinding = kb;
        if (kb) {
          keybindings.set(normalizeCombo(kb), commandId);
        }
        version++;
      }
    },

    mark_executed(id: string) {
      executionCounts.set(id, (executionCounts.get(id) ?? 0) + 1);
      lastExecutedId = id;
      version++;
    },
    last_executed_id() { return lastExecutedId; },
    execution_count(id: string) { return executionCounts.get(id) ?? 0; },

    set_page(p: number) {
      page = p;
      (this as ReturnType<typeof createMockEngine>)._page = p;
      version++;
    },
    set_page_size(s: number) {
      pageSize = s === 0 ? 50 : s;
      (this as ReturnType<typeof createMockEngine>)._pageSize = pageSize;
      page = 0;
      (this as ReturnType<typeof createMockEngine>)._page = 0;
      version++;
    },
    page() { return page; },
    page_size() { return pageSize; },
    page_count() {
      const total = getResults().length;
      if (total === 0) return 0;
      return Math.ceil(total / pageSize);
    },

    data_version() { return version; },
    reset() {
      commands.length = 0;
      keybindings.clear();
      executionCounts.clear();
      query = '';
      (this as ReturnType<typeof createMockEngine>)._query = '';
      lastExecutedId = '';
      page = 0;
      (this as ReturnType<typeof createMockEngine>)._page = 0;
      pageSize = 50;
      (this as ReturnType<typeof createMockEngine>)._pageSize = 50;
      version++;
    },
  };
}

describe('useCommandPaletteEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useCommandPaletteEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns CommandPaletteHandle with all methods when engine is provided', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.notifier.subscribe).toBe('function');
    expect(typeof handle.notifier.notify).toBe('function');
    expect(typeof handle.registerCommand).toBe('function');
    expect(typeof handle.unregisterCommand).toBe('function');
    expect(typeof handle.setEnabled).toBe('function');
    expect(typeof handle.setQuery).toBe('function');
    expect(typeof handle.setKeybinding).toBe('function');
    expect(typeof handle.markExecuted).toBe('function');
    expect(typeof handle.setPage).toBe('function');
    expect(typeof handle.setPageSize).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.getCommandPaletteState).toBe('function');
    expect(typeof handle.resolveKeybinding).toBe('function');
    expect(typeof handle.getKeybinding).toBe('function');
    expect(typeof handle.getExecutionCount).toBe('function');
    expect(typeof handle.isEnabled).toBe('function');
  });

  it('registerCommand calls engine.register_command and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', 'Ctrl+O');
    });

    expect(engine.command_count()).toBe(1);
    expect(engine.command_label('file.open')).toBe('Open File');
    expect(spy).toHaveBeenCalled();
  });

  it('unregisterCommand calls engine.unregister_command and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', 'Ctrl+O');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.unregisterCommand('file.open');
    });

    expect(engine.command_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('setEnabled calls engine.set_enabled and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', '');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setEnabled('file.open', false);
    });

    expect(engine.is_enabled('file.open')).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it('setQuery calls engine.set_query and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setQuery('open');
    });

    expect(engine.query()).toBe('open');
    expect(spy).toHaveBeenCalled();
  });

  it('setKeybinding calls engine.set_keybinding and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', '');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setKeybinding('file.open', 'Ctrl+O');
    });

    expect(engine.keybinding('file.open')).toBe('Ctrl+O');
    expect(spy).toHaveBeenCalled();
  });

  it('markExecuted calls engine.mark_executed and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', '');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.markExecuted('file.open');
    });

    expect(engine.last_executed_id()).toBe('file.open');
    expect(engine.execution_count('file.open')).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('setPage calls engine.set_page and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setPage(2);
    });

    expect(engine.page()).toBe(2);
    expect(spy).toHaveBeenCalled();
  });

  it('setPageSize calls engine.set_page_size and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setPageSize(25);
    });

    expect(engine.page_size()).toBe(25);
    expect(spy).toHaveBeenCalled();
  });

  it('reset calls engine.reset and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    // Set some state first
    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', 'Ctrl+O');
      handle.setQuery('open');
      handle.markExecuted('file.open');
      handle.setPage(1);
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.reset();
    });

    expect(engine.command_count()).toBe(0);
    expect(engine.query()).toBe('');
    expect(engine.last_executed_id()).toBe('');
    expect(engine.page()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('getCommandPaletteState reads all palette-level properties', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    const state = handle.getCommandPaletteState();
    expect(state).toEqual({
      commandCount: 0,
      query: '',
      resultCount: 0,
      page: 0,
      pageSize: 50,
      pageCount: 0,
      lastExecutedId: '',
      dataVersion: 0,
    });

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', '');
      handle.setQuery('open');
    });

    const state2 = handle.getCommandPaletteState();
    expect(state2.commandCount).toBe(1);
    expect(state2.query).toBe('open');
    expect(state2.dataVersion).toBeGreaterThan(0);
  });

  it('resolveKeybinding reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    expect(handle.resolveKeybinding('Ctrl+O')).toBe('');

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', 'Ctrl+O');
    });

    expect(handle.resolveKeybinding('Ctrl+O')).toBe('file.open');
  });

  it('getKeybinding reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', 'Ctrl+O');
    });

    expect(handle.getKeybinding('file.open')).toBe('Ctrl+O');
    expect(handle.getKeybinding('missing')).toBe('');
  });

  it('getExecutionCount reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', '');
    });

    expect(handle.getExecutionCount('file.open')).toBe(0);

    act(() => {
      handle.markExecuted('file.open');
      handle.markExecuted('file.open');
    });

    expect(handle.getExecutionCount('file.open')).toBe(2);
  });

  it('isEnabled reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useCommandPaletteEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.registerCommand('file.open', 'Open File', 'File', '');
    });

    expect(handle.isEnabled('file.open')).toBe(true);

    act(() => {
      handle.setEnabled('file.open', false);
    });

    expect(handle.isEnabled('file.open')).toBe(false);
  });
});
