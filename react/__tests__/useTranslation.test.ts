import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTranslation } from '../useTranslation';
import { createNotifier } from '../useWasmState';
import type { IIntlEngine } from '../../core/interfaces';
import type { IntlHandle } from '../useIntlEngine';
import type { IntlState } from '../../core/types';

function createMockEngine(): IIntlEngine {
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
  };
}

function createHandle(engine: IIntlEngine): IntlHandle {
  const notifier = createNotifier();
  return {
    engine,
    notifier,
    setLocale(locale: string): void {
      engine.set_locale(locale);
      notifier.notify();
    },
    addLocale(locale: string): void {
      engine.add_locale(locale);
      notifier.notify();
    },
    loadMessages(locale: string, json: string): void {
      engine.load_messages(locale, json);
      notifier.notify();
    },
    clearMessages(locale: string): void {
      engine.clear_messages(locale);
      notifier.notify();
    },
    setFallbackLocale(locale: string): void {
      engine.set_fallback_locale(locale);
      notifier.notify();
    },
    reset(): void {
      engine.reset();
      notifier.notify();
    },
    translate(key: string): string {
      return engine.translate(key);
    },
    translateWithParams(key: string, paramsJson: string): string {
      return engine.translate_with_params(key, paramsJson);
    },
    translatePlural(key: string, count: number): string {
      return engine.translate_plural(key, count);
    },
    getIntlState(): IntlState {
      return {
        locale: engine.current_locale(),
        fallbackLocale: engine.fallback_locale(),
        availableLocaleCount: engine.available_locales_count(),
        missingKeyCount: engine.missing_key_count(),
        dataVersion: engine.data_version(),
      };
    },
  };
}

describe('useTranslation', () => {
  it('returns empty TranslationState when handle is null', () => {
    const { result } = renderHook(() => useTranslation(null, 'greeting'));
    expect(result.current).toEqual({
      key: '',
      value: '',
      missing: false,
    });
  });

  it('returns correct translation when key exists (missing=false)', () => {
    const engine = createMockEngine();
    engine.set_locale('en');
    engine.load_messages('en', '{"greeting":"Hello"}');
    const handle = createHandle(engine);

    const { result } = renderHook(() => useTranslation(handle, 'greeting'));

    expect(result.current.key).toBe('greeting');
    expect(result.current.value).toBe('Hello');
    expect(result.current.missing).toBe(false);
  });

  it('returns key as value when missing (missing=true)', () => {
    const engine = createMockEngine();
    engine.set_locale('en');
    const handle = createHandle(engine);

    const { result } = renderHook(() => useTranslation(handle, 'nonexistent'));

    expect(result.current.key).toBe('nonexistent');
    expect(result.current.value).toBe('nonexistent');
    expect(result.current.missing).toBe(true);
  });

  it('missing is false when key is empty string', () => {
    const engine = createMockEngine();
    engine.set_locale('en');
    const handle = createHandle(engine);

    const { result } = renderHook(() => useTranslation(handle, ''));

    expect(result.current.key).toBe('');
    expect(result.current.value).toBe('');
    expect(result.current.missing).toBe(false);
  });

  it('updates on notify', () => {
    const engine = createMockEngine();
    engine.set_locale('en');
    const handle = createHandle(engine);

    const { result } = renderHook(() => useTranslation(handle, 'greeting'));

    expect(result.current.value).toBe('greeting');
    expect(result.current.missing).toBe(true);

    act(() => {
      handle.loadMessages('en', '{"greeting":"Hello"}');
    });

    expect(result.current.value).toBe('Hello');
    expect(result.current.missing).toBe(false);
  });
});
