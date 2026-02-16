/**
 * createIntlContext — Context factory for sharing an IntlHandle across
 * a component tree without prop drilling.
 *
 * Mirrors the createFormContext pattern: create once per intl engine type,
 * wrap at the root, read from any descendant.
 *
 * Usage:
 *   // context.ts
 *   export const { IntlProvider, useIntl, useIntlStatus, useTranslation } = createIntlContext<MyIntlEngine>();
 *
 *   // App.tsx
 *   <IntlProvider engine={engine}>
 *     <MyApp />
 *   </IntlProvider>
 *
 *   // Any descendant
 *   const { setLocale, translate } = useIntl();
 *   const { locale, missingKeyCount } = useIntlStatus();
 *   const { value, missing } = useTranslation('greeting');
 */

import { createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useIntlEngine } from './useIntlEngine';
import { useTranslation as useTranslationHook } from './useTranslation';
import { useIntlState } from './useIntlState';
import type { IntlHandle } from './useIntlEngine';
import type { IIntlEngine } from '../core/interfaces';
import type { TranslationState, IntlState } from '../core/types';

export interface IntlProviderProps<E extends IIntlEngine> {
  engine: E | null;
  children: ReactNode;
}

export interface IntlContextValue<E extends IIntlEngine> {
  IntlProvider: (props: IntlProviderProps<E>) => ReactNode;
  useIntl: () => IntlHandle<E>;
  useIntlStatus: () => IntlState;
  useTranslation: (key: string) => TranslationState;
}

export function createIntlContext<E extends IIntlEngine>(): IntlContextValue<E> {
  const HandleCtx = createContext<IntlHandle<E> | null>(null);

  function useIntl(): IntlHandle<E> {
    const ctx = useContext(HandleCtx);
    if (ctx === null) {
      throw new Error('useIntl must be used within an IntlProvider');
    }
    return ctx;
  }

  function useIntlStatus(): IntlState {
    const ctx = useContext(HandleCtx);
    return useIntlState(ctx);
  }

  function useTranslation(key: string): TranslationState {
    const ctx = useContext(HandleCtx);
    return useTranslationHook(ctx, key);
  }

  function IntlProvider({ engine, children }: IntlProviderProps<E>): ReactNode {
    const handle = useIntlEngine(engine);
    return createElement(HandleCtx.Provider, { value: handle }, children);
  }

  return { IntlProvider, useIntl, useIntlStatus, useTranslation };
}
