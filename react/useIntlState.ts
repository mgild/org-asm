/**
 * useIntlState — Top-level intl state subscription.
 *
 * For locale switchers, missing key indicators, and status displays.
 * Re-renders only when intl-level state (locale, fallbackLocale, etc.) changes.
 *
 * Usage:
 *   const { locale, missingKeyCount } = useIntlState(handle);
 *   <span>Current locale: {locale}</span>
 */

import { useWasmSelector } from './useWasmSelector';
import type { IntlHandle } from './useIntlEngine';
import type { IntlState } from '../core/types';

const EMPTY_STATE: IntlState = {
  locale: '',
  fallbackLocale: '',
  availableLocaleCount: 0,
  missingKeyCount: 0,
  dataVersion: 0,
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useIntlState(
  handle: IntlHandle | null,
): IntlState {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_STATE;
      const { engine } = handle;
      return {
        locale: engine.current_locale(),
        fallbackLocale: engine.fallback_locale(),
        availableLocaleCount: engine.available_locales_count(),
        missingKeyCount: engine.missing_key_count(),
        dataVersion: engine.data_version(),
      };
    },
  );
}
