import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { createIntlContext } from '../createIntlContext';
import type { IIntlEngine } from '../../core/interfaces';

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

describe('createIntlContext', () => {
  it('useIntl returns handle from provider', () => {
    const ctx = createIntlContext<IIntlEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.IntlProvider engine={engine}>
        {children}
      </ctx.IntlProvider>
    );

    const { result } = renderHook(() => ctx.useIntl(), { wrapper });
    const handle = result.current;

    expect(handle).not.toBe(null);
    expect(handle.engine).toBe(engine);
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

  it('useIntlStatus returns state from provider', () => {
    const ctx = createIntlContext<IIntlEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.IntlProvider engine={engine}>
        {children}
      </ctx.IntlProvider>
    );

    const { result } = renderHook(() => ctx.useIntlStatus(), { wrapper });

    expect(result.current).toEqual({
      locale: '',
      fallbackLocale: '',
      availableLocaleCount: 0,
      missingKeyCount: 0,
      dataVersion: 0,
    });
  });

  it('useTranslation returns translation from provider', () => {
    const ctx = createIntlContext<IIntlEngine>();
    const engine = createMockEngine();
    engine.set_locale('en');
    engine.load_messages('en', '{"greeting":"Hello"}');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.IntlProvider engine={engine}>
        {children}
      </ctx.IntlProvider>
    );

    const { result } = renderHook(() => ctx.useTranslation('greeting'), { wrapper });

    expect(result.current.key).toBe('greeting');
    expect(result.current.value).toBe('Hello');
    expect(result.current.missing).toBe(false);
  });

  it('useIntl throws outside provider', () => {
    const ctx = createIntlContext<IIntlEngine>();

    expect(() => {
      renderHook(() => ctx.useIntl());
    }).toThrow('useIntl must be used within an IntlProvider');
  });

  it('useIntlStatus returns empty state outside provider', () => {
    const ctx = createIntlContext<IIntlEngine>();

    const { result } = renderHook(() => ctx.useIntlStatus());

    expect(result.current).toEqual({
      locale: '',
      fallbackLocale: '',
      availableLocaleCount: 0,
      missingKeyCount: 0,
      dataVersion: 0,
    });
  });

  it('useTranslation returns empty state outside provider', () => {
    const ctx = createIntlContext<IIntlEngine>();

    const { result } = renderHook(() => ctx.useTranslation('greeting'));

    expect(result.current).toEqual({
      key: '',
      value: '',
      missing: false,
    });
  });

  it('children render correctly', () => {
    const ctx = createIntlContext<IIntlEngine>();
    const engine = createMockEngine();

    const { container } = render(
      <ctx.IntlProvider engine={engine}>
        <div data-testid="child">Hello from child</div>
      </ctx.IntlProvider>,
    );

    expect(container.textContent).toBe('Hello from child');
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('IntlProvider works with null engine', () => {
    const ctx = createIntlContext<IIntlEngine>();

    const { result } = renderHook(() => ctx.useTranslation('greeting'), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ctx.IntlProvider engine={null}>
          {children}
        </ctx.IntlProvider>
      ),
    });

    expect(result.current).toEqual({
      key: '',
      value: '',
      missing: false,
    });
  });

  it('mutations via useIntl propagate to useIntlStatus and useTranslation', () => {
    const ctx = createIntlContext<IIntlEngine>();
    const engine = createMockEngine();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ctx.IntlProvider engine={engine}>
        {children}
      </ctx.IntlProvider>
    );

    const { result } = renderHook(
      () => ({
        intl: ctx.useIntl(),
        status: ctx.useIntlStatus(),
        translation: ctx.useTranslation('greeting'),
      }),
      { wrapper },
    );

    expect(result.current.status.locale).toBe('');
    expect(result.current.translation.value).toBe('greeting');
    expect(result.current.translation.missing).toBe(true);

    act(() => {
      result.current.intl.setLocale('en');
      result.current.intl.loadMessages('en', '{"greeting":"Hello"}');
    });

    expect(result.current.status.locale).toBe('en');
    expect(result.current.translation.value).toBe('Hello');
    expect(result.current.translation.missing).toBe(false);
  });
});
