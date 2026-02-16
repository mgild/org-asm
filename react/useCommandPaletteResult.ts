/**
 * useCommandPaletteResult — Per-result subscription via useWasmSelector.
 *
 * Only this result's component re-renders when its state changes.
 * Other results remain untouched thanks to structural equality.
 *
 * Usage:
 *   const { id, label, score, isEnabled } = useCommandPaletteResult(handle, 0);
 *   if (id) {
 *     <div>{label} ({score})</div>
 *   }
 */

import { useWasmSelector } from './useWasmSelector';
import type { CommandPaletteHandle } from './useCommandPaletteEngine';
import type { CommandPaletteResult } from '../core/types';

const EMPTY_RESULT: CommandPaletteResult = {
  index: 0,
  id: '',
  label: '',
  category: '',
  score: 0,
  isEnabled: false,
  keybinding: '',
};

const noopSubscribe = (_cb: () => void): (() => void) => () => {};

export function useCommandPaletteResult(
  handle: CommandPaletteHandle | null,
  index: number,
): CommandPaletteResult {
  const notifier = handle ? handle.notifier : { subscribe: noopSubscribe };

  return useWasmSelector(
    notifier,
    () => {
      if (!handle) return EMPTY_RESULT;
      const { engine } = handle;
      const id = engine.result_id(index);
      if (id === '') {
        return { index, id: '', label: '', category: '', score: 0, isEnabled: false, keybinding: '' };
      }
      return {
        index,
        id,
        label: engine.result_label(index),
        category: engine.result_category(index),
        score: engine.result_score(index),
        isEnabled: engine.is_enabled(id),
        keybinding: engine.keybinding(id),
      };
    },
  );
}
