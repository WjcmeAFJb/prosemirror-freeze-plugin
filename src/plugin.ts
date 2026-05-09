import type { Node as PMNode } from 'prosemirror-model';
import { type EditorState, Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

import { isFrozenMarker, isFrozenNode } from './schema.js';
import {
  type FreezePluginOptions,
  type FreezePluginState,
  type FreezeTransactionMeta,
  type FrozenAttrs,
  type FrozenNodeMatch,
} from './types.js';

export const freezePluginKey = new PluginKey<FreezePluginState>('prosemirror-freeze-plugin');

export function getFreezePluginState(state: EditorState): FreezePluginState | null {
  return freezePluginKey.getState(state) ?? null;
}

export function isFreezeModeOn(state: EditorState): boolean {
  return getFreezePluginState(state)?.freezeMode ?? false;
}

/**
 * Walk the doc and return every frozen node keyed by id. Nodes without an
 * id are skipped — they cannot be tracked for preservation, which is fine
 * for transient inserts since the rule is "old → new", not "all nodes have ids".
 */
function collectFrozenById(doc: PMNode): Map<string, { node: PMNode; pos: number }> {
  const map = new Map<string, { node: PMNode; pos: number }>();
  doc.descendants((node, pos) => {
    if (isFrozenNode(node)) {
      const id = (node.attrs as FrozenAttrs).id;
      if (id) map.set(id, { node, pos });
      // Don't descend into frozen children — text nodes inside are part of
      // the frozen and are tracked through textContent on the parent.
      return false;
    }
    return true;
  });
  return map;
}

/**
 * Find the first inline node by descending into the leftmost block. Returns
 * `null` if the leftmost inline is not a frozen node, or if the doc is empty.
 */
function startsWithFrozen(doc: PMNode): { node: PMNode; isMarker: boolean } | null {
  let cur: PMNode | null = doc;
  while (cur && cur.firstChild) {
    const first: PMNode = cur.firstChild;
    if (isFrozenNode(first)) {
      return { node: first, isMarker: isFrozenMarker(first) };
    }
    if (first.isInline) return null;
    cur = first;
  }
  return null;
}

function endsWithFrozen(doc: PMNode): { node: PMNode; isMarker: boolean } | null {
  let cur: PMNode | null = doc;
  while (cur && cur.lastChild) {
    const last: PMNode = cur.lastChild;
    if (isFrozenNode(last)) {
      return { node: last, isMarker: isFrozenMarker(last) };
    }
    if (last.isInline) return null;
    cur = last;
  }
  return null;
}

/**
 * Returns true if every frozen node present in `oldDoc` is still present
 * in `newDoc` with the same `id` and the same textContent. New frozen
 * nodes added in `newDoc` are fine — what we're guarding against is
 * removal/mutation of existing ones.
 */
function frozenContentPreserved(oldDoc: PMNode, newDoc: PMNode): boolean {
  const oldFrozen = collectFrozenById(oldDoc);
  if (oldFrozen.size === 0) return true;
  const newFrozen = collectFrozenById(newDoc);
  for (const [id, oldEntry] of oldFrozen) {
    const newEntry = newFrozen.get(id);
    if (!newEntry) return false;
    if (oldEntry.node.textContent !== newEntry.node.textContent) {
      return false;
    }
  }
  return true;
}

/**
 * Boundary rule: if the document used to start with a *non-marker* frozen
 * node, the new doc must still start with a frozen node (any frozen — a
 * marker is fine, since markers exist precisely to enable insertion at
 * the boundary). Symmetric rule for the end.
 */
function boundaryPreserved(oldDoc: PMNode, newDoc: PMNode): boolean {
  const oldStart = startsWithFrozen(oldDoc);
  if (oldStart && !oldStart.isMarker && !startsWithFrozen(newDoc)) return false;
  const oldEnd = endsWithFrozen(oldDoc);
  if (oldEnd && !oldEnd.isMarker && !endsWithFrozen(newDoc)) return false;
  return true;
}

export function findFrozenInRange(doc: PMNode, from: number, to: number): FrozenNodeMatch | null {
  if (from === to) return null;
  let match: FrozenNodeMatch | null = null;
  doc.nodesBetween(from, to, (node, pos) => {
    if (match) return false;
    if (isFrozenNode(node)) {
      match = { node, pos, end: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return match;
}

export function selectionContainsFrozen(state: EditorState): boolean {
  const { from, to } = state.selection;
  return findFrozenInRange(state.doc, from, to) !== null;
}

export function readFreezeMeta(tr: Transaction): FreezeTransactionMeta {
  return (tr.getMeta(freezePluginKey) ?? {}) as FreezeTransactionMeta;
}

export function setFreezeMeta(tr: Transaction, meta: FreezeTransactionMeta): Transaction {
  const existing = readFreezeMeta(tr);
  tr.setMeta(freezePluginKey, { ...existing, ...meta });
  return tr;
}

/**
 * Compute decorations that lock every frozen node when freezeMode is on.
 *
 * `Decoration.node(...)` adds attributes to the rendered node element.
 * Marking the span as `contenteditable="false"` causes the browser to
 * decline edits inside it without us having to intercept input events
 * one by one — and gives a nice visual "this is locked" cue to native
 * accessibility tooling.
 */
function buildFreezeDecorations(state: EditorState): DecorationSet {
  const pluginState = freezePluginKey.getState(state);
  if (!pluginState?.freezeMode) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (isFrozenNode(node)) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          contenteditable: 'false',
          class: 'pm-frozen-locked',
        }),
      );
      return false;
    }
    return true;
  });
  return DecorationSet.create(state.doc, decorations);
}

/**
 * Build the freeze plugin instance.
 *
 * The plugin enforces three guarantees in `freezeMode`:
 * 1. Frozen nodes cannot be removed or modified by any transaction that does
 *    not carry the `allowFrozenChanges` meta flag.
 * 2. Non-frozen content cannot be inserted before/after the document's
 *    boundary frozen content unless a marker (empty frozen node) is present
 *    at that boundary.
 * 3. Cut events that would erase a frozen node are cancelled outright.
 *
 * It also installs `contenteditable="false"` decorations on every frozen
 * node so the browser refuses keystrokes inside locked content. Turning
 * off freeze mode removes both the filter and the decorations, making
 * frozen text fully editable in place.
 */
export function freezePlugin(options: FreezePluginOptions = {}): Plugin<FreezePluginState> {
  const initialFreezeMode = options.freezeMode ?? true;
  const blockCutOnFrozen = options.blockCutOnFrozen ?? true;

  return new Plugin<FreezePluginState>({
    key: freezePluginKey,
    state: {
      init(): FreezePluginState {
        return { freezeMode: initialFreezeMode };
      },
      apply(tr, prev): FreezePluginState {
        const meta = tr.getMeta(freezePluginKey) as FreezeTransactionMeta | undefined;
        if (meta && typeof meta.setFreezeMode === 'boolean') {
          return { ...prev, freezeMode: meta.setFreezeMode };
        }
        return prev;
      },
    },
    filterTransaction(tr, state): boolean {
      const pluginState = freezePluginKey.getState(state);
      if (!pluginState?.freezeMode) return true;
      if (!tr.docChanged) return true;

      const meta = tr.getMeta(freezePluginKey) as FreezeTransactionMeta | undefined;
      if (meta?.allowFrozenChanges === true) return true;

      if (!frozenContentPreserved(state.doc, tr.doc)) return false;
      if (!boundaryPreserved(state.doc, tr.doc)) return false;
      return true;
    },
    props: {
      decorations(state): DecorationSet {
        return buildFreezeDecorations(state);
      },
      handleDOMEvents: {
        cut(view: EditorView, event: Event): boolean {
          if (!blockCutOnFrozen) return false;
          if (!isFreezeModeOn(view.state)) return false;
          if (!selectionContainsFrozen(view.state)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  });
}

export const _internal = {
  collectFrozenById,
  startsWithFrozen,
  endsWithFrozen,
  frozenContentPreserved,
  boundaryPreserved,
  buildFreezeDecorations,
};
