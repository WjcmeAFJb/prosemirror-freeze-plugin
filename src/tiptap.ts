import { type Editor, mergeAttributes, Node } from '@tiptap/core';
import type { Plugin } from 'prosemirror-state';

import {
  applyAddFrozen,
  applyClearFrozen,
  applyFreezeSelection,
  applyInsertEndMarker,
  applyInsertStartMarker,
  applyRemoveEndMarker,
  applyRemoveStartMarker,
  applySetFreezeMode,
  applyToggleFreeze,
  canFreezeRange,
} from './commands.js';
import { defaultGenerateId } from './id.js';
import { freezePlugin, freezePluginKey } from './plugin.js';

/**
 * Per-action keyboard shortcut overrides for {@link Frozen}. A string
 * value (e.g. `"Mod-Shift-f"`) replaces the default binding; `false`
 * unbinds the action entirely so the keystroke falls through to other
 * extensions or the platform.
 */
export interface FreezeExtensionShortcuts {
  /** Default `Mod-b`. Toggles freeze on the current selection. */
  toggleFreeze?: string | false;
  /** Default `Mod-Shift-b`. Always unfreezes. */
  clearFrozen?: string | false;
  /** Default `Mod-Shift-l`. Flips the editor-wide freeze mode. */
  toggleFreezeMode?: string | false;
}

export interface FreezeExtensionOptions {
  /** Initial freeze-mode value. Defaults to true. */
  freezeMode: boolean;
  /** Cancel `cut` events when the selection contains frozen content. */
  blockCutOnFrozen: boolean;
  /** Generator for new frozen ids. Defaults to a UUID-ish generator. */
  generateId: () => string;
  /** Extra HTML attributes merged onto the rendered <span>. */
  HTMLAttributes: Record<string, unknown>;
  /**
   * Customise the keyboard shortcuts the extension installs. Anything
   * you don't override keeps its default; `false` disables that
   * binding so the key falls through to other extensions.
   */
  shortcuts: FreezeExtensionShortcuts;
}

const DEFAULT_SHORTCUTS = {
  toggleFreeze: 'Mod-b',
  clearFrozen: 'Mod-Shift-b',
  toggleFreezeMode: 'Mod-Shift-l',
} as const satisfies Required<{
  [K in keyof FreezeExtensionShortcuts]: string;
}>;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    frozen: {
      /** Insert a frozen node carrying `text` at the current cursor. */
      addFrozen: (text: string) => ReturnType;
      /** Wrap the current selection's content (with marks) in a frozen. */
      freezeSelection: () => ReturnType;
      /**
       * Unfreeze: replace the frozen node(s) at/under the selection with
       * their inline content. Empty frozens (markers) are removed entirely.
       */
      clearFrozen: () => ReturnType;
      /** Toggle: unfreeze if frozen content is involved, else freeze the selection. */
      toggleFreeze: () => ReturnType;
      /** Pin a boundary marker at the document start. */
      insertStartMarker: () => ReturnType;
      /** Pin a boundary marker at the document end. */
      insertEndMarker: () => ReturnType;
      /** Symmetric to {@link Commands.frozen.insertStartMarker}. */
      removeStartMarker: () => ReturnType;
      /** Symmetric to {@link Commands.frozen.insertEndMarker}. */
      removeEndMarker: () => ReturnType;
      /** Flip the freeze-mode flag. */
      toggleFreezeMode: () => ReturnType;
      /** Set the freeze-mode flag explicitly. */
      setFreezeMode: (value: boolean) => ReturnType;
    };
  }
}

/**
 * TipTap Node extension that registers the frozen schema, adds
 * `editor.commands.freezeSelection()` etc., wires the standard freeze
 * keyboard shortcuts, and installs the underlying ProseMirror plugin.
 *
 * Drop it into your TipTap editor's `extensions` array alongside
 * StarterKit (or whatever schema you use) and frozen sections light up.
 *
 * ```ts
 * import { Editor } from '@tiptap/core';
 * import StarterKit from '@tiptap/starter-kit';
 * import { Frozen } from 'prosemirror-freeze-plugin/tiptap';
 *
 * new Editor({
 *   element: document.querySelector('#editor'),
 *   extensions: [StarterKit, Frozen.configure({ freezeMode: true })],
 *   content: '<p>Hello <span data-frozen="true">WORLD</span>!</p>',
 * });
 * ```
 */
export const Frozen = Node.create<FreezeExtensionOptions>({
  name: 'frozen',

  inline: true,
  group: 'inline',
  content: 'text*',
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      freezeMode: true,
      blockCutOnFrozen: true,
      generateId: defaultGenerateId,
      HTMLAttributes: {},
      shortcuts: {},
    };
  },

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element) => (element as HTMLElement).dataset['frozenId'] ?? '',
        renderHTML: (attrs) => (attrs['id'] ? { 'data-frozen-id': attrs['id'] as string } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-frozen="true"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const isMarker = node.content.size === 0;
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: isMarker ? 'pm-frozen pm-frozen-marker' : 'pm-frozen',
        'data-frozen': 'true',
        'data-frozen-marker': isMarker ? 'true' : 'false',
      }),
      0,
    ];
  },

  addCommands() {
    const gen = (): string => this.options.generateId();
    return {
      addFrozen:
        (text: string) =>
        ({ state, tr, dispatch }) => {
          if (text.length === 0) return false;
          if (!state.schema.nodes['frozen']) return false;
          if (dispatch) applyAddFrozen(tr, state.schema, text, gen());
          return true;
        },

      freezeSelection:
        () =>
        ({ state, tr, dispatch }) => {
          if (!canFreezeRange(state.doc, state.selection.from, state.selection.to)) {
            return false;
          }
          if (dispatch) applyFreezeSelection(tr, state, gen());
          return true;
        },

      clearFrozen:
        () =>
        ({ state, tr, dispatch }) => {
          if (!dispatch) {
            // Probe-only: check whether there is anything to clear without
            // mutating the transaction.
            return applyClearFrozen(state.tr, state);
          }
          return applyClearFrozen(tr, state);
        },

      toggleFreeze:
        () =>
        ({ state, tr, dispatch }) => {
          if (!dispatch) {
            return applyToggleFreeze(state.tr, state, gen());
          }
          return applyToggleFreeze(tr, state, gen());
        },

      insertStartMarker:
        () =>
        ({ state, tr, dispatch }) => {
          if (!dispatch) {
            return applyInsertStartMarker(state.tr, state.doc, state.schema, gen());
          }
          return applyInsertStartMarker(tr, state.doc, state.schema, gen());
        },

      insertEndMarker:
        () =>
        ({ state, tr, dispatch }) => {
          if (!dispatch) {
            return applyInsertEndMarker(state.tr, state.doc, state.schema, gen());
          }
          return applyInsertEndMarker(tr, state.doc, state.schema, gen());
        },

      removeStartMarker:
        () =>
        ({ state, tr, dispatch }) => {
          if (!dispatch) return applyRemoveStartMarker(state.tr, state.doc);
          return applyRemoveStartMarker(tr, state.doc);
        },

      removeEndMarker:
        () =>
        ({ state, tr, dispatch }) => {
          if (!dispatch) return applyRemoveEndMarker(state.tr, state.doc);
          return applyRemoveEndMarker(tr, state.doc);
        },

      toggleFreezeMode:
        () =>
        ({ state, tr, dispatch }) => {
          const cur = freezePluginKey.getState(state)?.freezeMode ?? false;
          if (dispatch) applySetFreezeMode(tr, !cur);
          return true;
        },

      setFreezeMode:
        (value: boolean) =>
        ({ tr, dispatch }) => {
          if (dispatch) applySetFreezeMode(tr, value);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const overrides = this.options.shortcuts ?? {};
    const bindings: Record<string, (props: { editor: Editor }) => boolean> = {};
    const handlers = {
      toggleFreeze: ({ editor }: { editor: Editor }) => editor.chain().toggleFreeze().run(),
      clearFrozen: ({ editor }: { editor: Editor }) => editor.chain().clearFrozen().run(),
      toggleFreezeMode: ({ editor }: { editor: Editor }) => editor.chain().toggleFreezeMode().run(),
    } as const satisfies Record<
      keyof FreezeExtensionShortcuts,
      (props: { editor: Editor }) => boolean
    >;
    for (const action of Object.keys(handlers) as (keyof typeof handlers)[]) {
      const override = overrides[action];
      if (override === false) continue;
      const key = override ?? DEFAULT_SHORTCUTS[action];
      bindings[key] = handlers[action];
    }
    return bindings;
  },

  addProseMirrorPlugins(): Plugin[] {
    return [
      freezePlugin({
        freezeMode: this.options.freezeMode,
        blockCutOnFrozen: this.options.blockCutOnFrozen,
      }),
    ];
  },
});

export default Frozen;
