/**
 * useTranslation — Per-key translation subscription via useWasmSelector.
 *
 * Only this key's component re-renders when its translation changes.
 * Other keys remain untouched thanks to structural equality.
 *
 * Usage:
 *   const { value, missing } = useTranslation(handle, 'greeting');
 *   <span>{value}</span>
 *   {missing && <span>Translation missing!</span>}
 */

import { useWasmSelector } from './useWasmSelector';
import type { IntlHandle } from './useIntlEngine';
import type { TranslationState } from '../core/types';

const EMPTY_TRANSLATION: TranslationState = {
  key: '',
  value: '',
  missing: false,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useTranslation(
  handle: IntlHandle | null,
  key: string,
): TranslationState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_TRANSLATION;
      const { engine } = handle;
      const value = engine.translate(key);
      const missing = value === key && key !== '';
      return { key, value, missing };
    },
  );
}
