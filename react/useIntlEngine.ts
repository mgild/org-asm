/**
 * useIntlEngine — Creates an IntlHandle wrapping a Rust IIntlEngine.
 *
 * The handle provides dispatch functions (setLocale, addLocale, loadMessages,
 * clearMessages, setFallbackLocale, reset) that mutate the engine and notify
 * subscribers. State-level and per-key hooks (useIntlState, useTranslation)
 * subscribe via the notifier to re-render on changes.
 *
 * Usage:
 *   const engine = useMemo(() => new MyIntlEngine(), []);
 *   const handle = useIntlEngine(engine);
 *   if (!handle) return null;
 *
 *   handle.setLocale('fr');
 *   const text = handle.translate('greeting');
 */

import { useMemo } from 'react';
import { createNotifier } from './useWasmState';
import type { WasmNotifier } from './useWasmState';
import type { IIntlEngine } from '../core/interfaces';
import type { IntlState } from '../core/types';

export interface IntlHandle<E extends IIntlEngine = IIntlEngine> {
  readonly engine: E;
  readonly notifier: WasmNotifier;
  setLocale(locale: string): void;
  addLocale(locale: string): void;
  loadMessages(locale: string, json: string): void;
  clearMessages(locale: string): void;
  setFallbackLocale(locale: string): void;
  reset(): void;
  translate(key: string): string;
  translateWithParams(key: string, paramsJson: string): string;
  translatePlural(key: string, count: number): string;
  getIntlState(): IntlState;
}

export function useIntlEngine<E extends IIntlEngine>(
  engine: E | null,
): IntlHandle<E> | null {
  const notifier = useMemo(() => createNotifier(), []);

  return useMemo(() => {
    if (engine === null) return null;

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
  }, [engine, notifier]);
}
