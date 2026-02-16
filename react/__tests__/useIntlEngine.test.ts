import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIntlEngine } from '../useIntlEngine';
import { createNotifier } from '../useWasmState';
import type { IIntlEngine } from '../../core/interfaces';

function createMockEngine(): IIntlEngine & {
  _locale: string;
  _fallbackLocale: string;
  _locales: string[];
  _catalogs: Map<string, Map<string, string>>;
  _missingKeys: string[];
} {
  let locale = '';
  let fallbackLocale = '';
  const locales: string[] = [];
  const catalogs = new Map<string, Map<string, string>>();
  const missingKeys: string[] = [];
  let version = 0;

  return {
    set_locale(l: string) { locale = l; version++; },
    current_locale() { return locale; },
    available_locales_count() { return locales.length; },
    available_locale(index: number) { return locales[index] ?? ''; },
    add_locale(l: string) { locales.push(l); version++; },
    load_messages(l: string, json: string) {
      const msgs = JSON.parse(json) as Record<string, string>;
      const map = catalogs.get(l) ?? new Map<string, string>();
      for (const [k, v] of Object.entries(msgs)) map.set(k, v);
      catalogs.set(l, map);
      version++;
    },
    clear_messages(l: string) { catalogs.delete(l); version++; },
    translate(key: string) {
      const map = catalogs.get(locale);
      if (map && map.has(key)) return map.get(key)!;
      const fb = catalogs.get(fallbackLocale);
      if (fb && fb.has(key)) return fb.get(key)!;
      if (!missingKeys.includes(key)) missingKeys.push(key);
      return key;
    },
    translate_with_params(key: string, paramsJson: string) {
      let result = catalogs.get(locale)?.get(key) ?? key;
      const params = JSON.parse(paramsJson) as Record<string, string>;
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(`{${k}}`, v);
      }
      return result;
    },
    translate_plural(key: string, count: number) {
      const map = catalogs.get(locale);
      if (!map) return key;
      if (count === 0) return map.get(`${key}.zero`) ?? map.get(`${key}.other`) ?? key;
      if (count === 1) return map.get(`${key}.one`) ?? key;
      return map.get(`${key}.other`) ?? key;
    },
    missing_key_count() { return missingKeys.length; },
    missing_key(index: number) { return missingKeys[index] ?? ''; },
    set_fallback_locale(l: string) { fallbackLocale = l; version++; },
    fallback_locale() { return fallbackLocale; },
    data_version() { return version; },
    reset() {
      locale = '';
      fallbackLocale = '';
      locales.length = 0;
      catalogs.clear();
      missingKeys.length = 0;
      version++;
    },
    _locale: locale,
    get _fallbackLocale() { return fallbackLocale; },
    _locales: locales,
    _catalogs: catalogs,
    _missingKeys: missingKeys,
  };
}

describe('useIntlEngine', () => {
  it('returns null when engine is null', () => {
    const { result } = renderHook(() => useIntlEngine(null));
    expect(result.current).toBe(null);
  });

  it('returns IntlHandle with all methods when engine is provided', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useIntlEngine(engine));
    const handle = result.current!;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
    expect(typeof handle.notifier.subscribe).toBe('function');
    expect(typeof handle.notifier.notify).toBe('function');
    expect(typeof handle.setLocale).toBe('function');
    expect(typeof handle.addLocale).toBe('function');
    expect(typeof handle.loadMessages).toBe('function');
    expect(typeof handle.clearMessages).toBe('function');
    expect(typeof handle.setFallbackLocale).toBe('function');
    expect(typeof handle.reset).toBe('function');
    expect(typeof handle.translate).toBe('function');
    expect(typeof handle.translateWithParams).toBe('function');
    expect(typeof handle.translatePlural).toBe('function');
    expect(typeof handle.getIntlState).toBe('function');
  });

  it('setLocale calls engine and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useIntlEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setLocale('fr');
    });

    expect(engine.current_locale()).toBe('fr');
    expect(spy).toHaveBeenCalled();
  });

  it('addLocale calls engine and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useIntlEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.addLocale('de');
    });

    expect(engine.available_locales_count()).toBe(1);
    expect(engine.available_locale(0)).toBe('de');
    expect(spy).toHaveBeenCalled();
  });

  it('loadMessages calls engine and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useIntlEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setLocale('en');
      handle.loadMessages('en', '{"greeting":"Hello"}');
    });

    expect(engine.translate('greeting')).toBe('Hello');
    expect(spy).toHaveBeenCalled();
  });

  it('clearMessages calls engine and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useIntlEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setLocale('en');
      handle.loadMessages('en', '{"greeting":"Hello"}');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.clearMessages('en');
    });

    expect(engine.translate('greeting')).toBe('greeting');
    expect(spy).toHaveBeenCalled();
  });

  it('setFallbackLocale calls engine and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useIntlEngine(engine));
    const handle = result.current!;

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.setFallbackLocale('en');
    });

    expect(engine.fallback_locale()).toBe('en');
    expect(spy).toHaveBeenCalled();
  });

  it('reset calls engine and notifies', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useIntlEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setLocale('fr');
      handle.addLocale('fr');
      handle.loadMessages('fr', '{"greeting":"Bonjour"}');
    });

    const spy = vi.fn();
    handle.notifier.subscribe(spy);

    act(() => {
      handle.reset();
    });

    expect(engine.current_locale()).toBe('');
    expect(engine.fallback_locale()).toBe('');
    expect(engine.available_locales_count()).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('translate reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useIntlEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setLocale('en');
      handle.loadMessages('en', '{"greeting":"Hello"}');
    });

    expect(handle.translate('greeting')).toBe('Hello');
    expect(handle.translate('missing_key')).toBe('missing_key');
  });

  it('translateWithParams reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useIntlEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setLocale('en');
      handle.loadMessages('en', '{"welcome":"Hello {name}!"}');
    });

    expect(handle.translateWithParams('welcome', '{"name":"Alice"}')).toBe('Hello Alice!');
  });

  it('translatePlural reads from engine', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useIntlEngine(engine));
    const handle = result.current!;

    act(() => {
      handle.setLocale('en');
      handle.loadMessages('en', '{"items.zero":"No items","items.one":"1 item","items.other":"{count} items"}');
    });

    expect(handle.translatePlural('items', 0)).toBe('No items');
    expect(handle.translatePlural('items', 1)).toBe('1 item');
    expect(handle.translatePlural('items', 5)).toBe('{count} items');
  });

  it('getIntlState reads all properties', () => {
    const engine = createMockEngine();
    const { result } = renderHook(() => useIntlEngine(engine));
    const handle = result.current!;

    const state = handle.getIntlState();
    expect(state).toEqual({
      locale: '',
      fallbackLocale: '',
      availableLocaleCount: 0,
      missingKeyCount: 0,
      dataVersion: 0,
    });

    act(() => {
      handle.setLocale('en');
      handle.setFallbackLocale('fr');
      handle.addLocale('en');
      handle.addLocale('fr');
    });

    const state2 = handle.getIntlState();
    expect(state2.locale).toBe('en');
    expect(state2.fallbackLocale).toBe('fr');
    expect(state2.availableLocaleCount).toBe(2);
    expect(state2.dataVersion).toBeGreaterThan(0);
  });
});
