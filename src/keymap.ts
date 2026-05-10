import { keymap } from 'prosemirror-keymap';
import type { Plugin } from 'prosemirror-state';

import { clearFrozen, toggleFreeze, toggleFreezeMode } from './commands.js';
import type { Command } from './types.js';

interface KeymapOptions {
  /** Bind {@link toggleFreeze}. Defaults to `Mod-b`. */
  freezeKey?: string | false;
  /** Bind {@link toggleFreezeMode}. Defaults to `Mod-Shift-l`. */
  toggleModeKey?: string | false;
  /** Bind {@link clearFrozen}. Defaults to `Mod-Shift-b`. */
  clearKey?: string | false;
  /** Extra bindings to merge in. */
  extra?: Record<string, Command>;
}

/**
 * Default keymap for the freeze plugin.
 *
 * - `Mod-b` runs {@link toggleFreeze}: freezes the selection if it is
 *   plain text, or unfreezes (replaces with the inner text) when the
 *   selection touches a frozen node. Note this displaces the
 *   conventional bold shortcut; if you need bold on `Mod-b`, pass
 *   `freezeKey: 'Mod-Shift-b'` (or another key) and wire bold yourself.
 * - `Mod-Shift-b` runs {@link clearFrozen} (always unfreezes).
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
    bindings[freezeKey] = toggleFreeze();
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
