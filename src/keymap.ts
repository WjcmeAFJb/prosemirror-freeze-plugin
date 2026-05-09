import { keymap } from 'prosemirror-keymap';
import type { Plugin } from 'prosemirror-state';

import { clearFrozen, freezeSelection, toggleFreezeMode } from './commands.js';
import type { Command } from './types.js';

interface KeymapOptions {
  /** Bind a freeze-toggle command. Defaults to `Mod-b` (freeze selection). */
  freezeKey?: string | false;
  /** Bind toggleFreezeMode. Defaults to `Mod-Shift-l` (lock toggle). */
  toggleModeKey?: string | false;
  /** Bind clearFrozen. Defaults to `Mod-Shift-b`. */
  clearKey?: string | false;
  /** Extra bindings to merge in. */
  extra?: Record<string, Command>;
}

/**
 * Default keymap for the freeze plugin.
 *
 * - `Mod-b` toggles a frozen wrap on the current selection. Press once
 *   on a non-frozen selection to freeze it, press again on the resulting
 *   selection to clear it. (Note: this displaces the conventional bold
 *   shortcut; if you need bold on `Mod-b`, pass `freezeKey: 'Mod-Shift-b'`
 *   or another binding here and wire bold separately.)
 * - `Mod-Shift-l` toggles freeze mode for the whole editor.
 *
 * Add this plugin AFTER your base/keymap plugins so it can override
 * conflicting bindings.
 */
export function freezeKeymap(options: KeymapOptions = {}): Plugin {
  const {
    freezeKey = 'Mod-b',
    toggleModeKey = 'Mod-Shift-l',
    clearKey = 'Mod-Shift-b',
    extra,
  } = options;

  const bindings: Record<string, Command> = {};

  if (freezeKey !== false) {
    bindings[freezeKey] = (state, dispatch) => {
      // Toggle: if the selection touches frozen, clear; otherwise freeze.
      if (clearFrozen(state, dispatch)) return true;
      return freezeSelection()(state, dispatch);
    };
  }

  if (toggleModeKey !== false) {
    bindings[toggleModeKey] = toggleFreezeMode;
  }

  if (clearKey !== false) {
    bindings[clearKey] = clearFrozen;
  }

  if (extra) {
    Object.assign(bindings, extra);
  }

  return keymap(bindings);
}
