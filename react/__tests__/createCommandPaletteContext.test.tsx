import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createCommandPaletteContext } from '../createCommandPaletteContext';
import type { ICommandPaletteEngine } from '../../core/interfaces';

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

describe('createCommandPaletteContext', () => {
  it('useCommandPalette returns handle from provider', () => {
    const ctx = createCommandPaletteContext<ICommandPaletteEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.CommandPaletteProvider engine={engine}>
        {children}
      </ctx.CommandPaletteProvider>
    );

    const { result } = renderHook(() => ctx.useCommandPalette(), { wrapper });
    const handle = result.current;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
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

  it('useCommandPaletteResult returns result state from provider', () => {
    const ctx = createCommandPaletteContext<ICommandPaletteEngine>();
    const engine = createMockEngine();
    engine.register_command('file.open', 'Open File', 'File', 'Ctrl+O');
    engine.register_command('file.save', 'Save File', 'File', 'Ctrl+S');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.CommandPaletteProvider engine={engine}>
        {children}
      </ctx.CommandPaletteProvider>
    );

    const { result } = renderHook(() => ctx.useCommandPaletteResult(0), { wrapper });

    expect(result.current.index).toBe(0);
    expect(result.current.id).toBe('file.open');
    expect(result.current.label).toBe('Open File');
    expect(result.current.isEnabled).toBe(true);
  });

  it('useCommandPaletteStatus returns palette state from provider', () => {
    const ctx = createCommandPaletteContext<ICommandPaletteEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.CommandPaletteProvider engine={engine}>
        {children}
      </ctx.CommandPaletteProvider>
    );

    const { result } = renderHook(() => ctx.useCommandPaletteStatus(), { wrapper });

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

  it('useCommandPalette throws outside provider', () => {
    const ctx = createCommandPaletteContext<ICommandPaletteEngine>();

    expect(() => {
      renderHook(() => ctx.useCommandPalette());
    }).toThrow('useCommandPalette must be used within a CommandPaletteProvider');
  });

  it('useCommandPaletteResult returns empty state outside provider (null handle)', () => {
    const ctx = createCommandPaletteContext<ICommandPaletteEngine>();

    const { result } = renderHook(() => ctx.useCommandPaletteResult(0));

    expect(result.current).toEqual({
      index: 0,
      id: '',
      label: '',
      category: '',
      score: 0,
      isEnabled: false,
      keybinding: '',
    });
  });

  it('useCommandPaletteStatus returns empty state outside provider (null handle)', () => {
    const ctx = createCommandPaletteContext<ICommandPaletteEngine>();

    const { result } = renderHook(() => ctx.useCommandPaletteStatus());

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

  it('children render correctly', () => {
    const ctx = createCommandPaletteContext<ICommandPaletteEngine>();
    const engine = createMockEngine();

    const { container } = render(
      <ctx.CommandPaletteProvider engine={engine}>
        <div data-testid="child">Hello from child</div>
      </ctx.CommandPaletteProvider>,
    );

    expect(container.textContent).toBe('Hello from child');
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('CommandPaletteProvider works with null engine', () => {
    const ctx = createCommandPaletteContext<ICommandPaletteEngine>();

    const { result } = renderHook(() => ctx.useCommandPaletteResult(0), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.CommandPaletteProvider engine={null}>
          {children}
        </ctx.CommandPaletteProvider>
      ),
    });

    expect(result.current).toEqual({
      index: 0,
      id: '',
      label: '',
      category: '',
      score: 0,
      isEnabled: false,
      keybinding: '',
    });
  });

  it('mutations via useCommandPalette propagate to useCommandPaletteResult and useCommandPaletteStatus', () => {
    const ctx = createCommandPaletteContext<ICommandPaletteEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.CommandPaletteProvider engine={engine}>
        {children}
      </ctx.CommandPaletteProvider>
    );

    const { result } = renderHook(
      () => ({
        palette: ctx.useCommandPalette(),
        result0: ctx.useCommandPaletteResult(0),
        status: ctx.useCommandPaletteStatus(),
      }),
      { wrapper },
    );

    expect(result.current.result0.id).toBe('');
    expect(result.current.status.commandCount).toBe(0);
    expect(result.current.status.query).toBe('');

    act(() => {
      result.current.palette.registerCommand('file.open', 'Open File', 'File', 'Ctrl+O');
    });

    expect(result.current.result0.id).toBe('file.open');
    expect(result.current.result0.label).toBe('Open File');
    expect(result.current.result0.isEnabled).toBe(true);
    expect(result.current.status.commandCount).toBe(1);

    act(() => {
      result.current.palette.setQuery('open');
    });

    expect(result.current.status.query).toBe('open');
  });
});
