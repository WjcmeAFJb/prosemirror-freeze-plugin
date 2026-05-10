import {
  Fragment,
  type Node as PMNode,
  type NodeType,
  type Schema,
  Slice,
} from 'prosemirror-model';
import { type EditorState, type Selection, type Transaction } from 'prosemirror-state';

import { defaultGenerateId } from './id.js';
import { findFrozenInRange, freezePluginKey, isFreezeModeOn, setFreezeMeta } from './plugin.js';
import { isFrozenMarker, isFrozenNode } from './schema.js';
import { type Command, FROZEN_NODE_NAME, type FrozenAttrs } from './types.js';

interface CommandOptions {
  generateId?: () => string;
}

function getFrozenType(state: EditorState | { schema: Schema }): NodeType | null {
  return state.schema.nodes[FROZEN_NODE_NAME] ?? null;
}

function findStartContentPos(doc: PMNode): number | null {
  let cur: PMNode = doc;
  let pos = 0;
  while (cur.firstChild) {
    const first = cur.firstChild;
    if (first.isInline) break;
    if (first.isAtom) return null;
    cur = first;
    pos += 1;
    if (first.isTextblock) break;
  }
  if (cur === doc) return null;
  return pos;
}

function findEndContentPos(doc: PMNode): number | null {
  let cur: PMNode = doc;
  let pos = doc.content.size;
  while (cur.lastChild) {
    const last = cur.lastChild;
    if (last.isInline) break;
    if (last.isAtom) return null;
    cur = last;
    pos -= 1;
    if (last.isTextblock) break;
  }
  if (cur === doc) return null;
  return pos;
}

// ---------------------------------------------------------------------------
// `apply*` helpers — operate on a caller-provided transaction. The PM-style
// commands below are thin shells around them, and the TipTap extension calls
// the same helpers from its `addCommands()` so both editor flavours share
// behaviour without copy-paste.

export function applySetFreezeMode(tr: Transaction, value: boolean): boolean {
  setFreezeMeta(tr, { setFreezeMode: value });
  return true;
}

export function applyAddFrozen(tr: Transaction, schema: Schema, text: string, id: string): boolean {
  const type = schema.nodes[FROZEN_NODE_NAME];
  if (!type || text.length === 0) return false;
  const node = type.create({ id } satisfies FrozenAttrs, [schema.text(text)]);
  tr.replaceSelectionWith(node, false);
  tr.scrollIntoView();
  setFreezeMeta(tr, { allowFrozenChanges: true });
  return true;
}

export function canFreezeRange(doc: PMNode, from: number, to: number): boolean {
  if (from === to) return false;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if ($from.parent !== $to.parent || !$from.parent.isTextblock) return false;
  const slice = doc.slice(from, to);
  if (slice.content.size === 0) return false;
  let containsFrozen = false;
  slice.content.descendants((n) => {
    if (isFrozenNode(n)) {
      containsFrozen = true;
      return false;
    }
    return true;
  });
  return !containsFrozen;
}

export function applyFreezeSelection(
  tr: Transaction,
  state: { doc: PMNode; selection: Selection; schema: Schema },
  id: string,
): boolean {
  const { from, to } = state.selection;
  if (!canFreezeRange(state.doc, from, to)) return false;
  const type = state.schema.nodes[FROZEN_NODE_NAME];
  if (!type) return false;
  const slice = state.doc.slice(from, to);
  const frozen = type.create({ id } satisfies FrozenAttrs, slice.content);
  tr.replaceWith(from, to, frozen);
  tr.scrollIntoView();
  setFreezeMeta(tr, { allowFrozenChanges: true });
  return true;
}

interface FoundFrozen {
  node: PMNode;
  pos: number;
}

function findFrozenForClear(state: { doc: PMNode; selection: Selection }): FoundFrozen[] {
  const { from, to, empty } = state.selection;
  const found: FoundFrozen[] = [];
  if (empty) {
    const $from = state.selection.$from;
    const before = $from.nodeBefore;
    const after = $from.nodeAfter;
    if (isFrozenNode(before)) {
      found.push({ node: before!, pos: $from.pos - before!.nodeSize });
    } else if (isFrozenNode(after)) {
      found.push({ node: after!, pos: $from.pos });
    } else if ($from.parent.type.name === FROZEN_NODE_NAME) {
      const wrapPos = $from.before($from.depth);
      found.push({ node: $from.parent, pos: wrapPos });
    }
  } else {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (isFrozenNode(node)) {
        found.push({ node, pos });
        return false;
      }
      return true;
    });
  }
  return found;
}

/**
 * "Unfreeze" the frozen nodes adjacent to / under the selection. Each
 * targeted node is replaced with its inline content (preserving marks),
 * which in particular means an empty frozen — a marker — is removed
 * outright rather than leaving a zero-width frozen behind.
 */
export function applyClearFrozen(
  tr: Transaction,
  state: { doc: PMNode; selection: Selection },
): boolean {
  const targets = findFrozenForClear(state);
  if (targets.length === 0) return false;
  // Replace in reverse so earlier positions remain valid against `tr.doc`.
  for (let i = targets.length - 1; i >= 0; i--) {
    const { node, pos } = targets[i]!;
    const start = pos;
    const end = pos + node.nodeSize;
    if (node.content.size === 0) {
      tr.delete(start, end);
    } else {
      tr.replaceWith(start, end, node.content);
    }
  }
  setFreezeMeta(tr, { allowFrozenChanges: true });
  return true;
}

/**
 * Toggle freezing for the current selection. If anything is frozen at or
 * adjacent to the selection it gets unfrozen; otherwise the selection is
 * frozen via {@link applyFreezeSelection}. Returns false when neither
 * branch can apply.
 */
export function applyToggleFreeze(
  tr: Transaction,
  state: { doc: PMNode; selection: Selection; schema: Schema },
  id: string,
): boolean {
  if (findFrozenForClear(state).length > 0) {
    return applyClearFrozen(tr, state);
  }
  return applyFreezeSelection(tr, state, id);
}

function makeMarker(schema: Schema, id: string): PMNode | null {
  const type = schema.nodes[FROZEN_NODE_NAME];
  if (!type) return null;
  return type.create({ id } satisfies FrozenAttrs, Fragment.empty);
}

export function applyInsertStartMarker(
  tr: Transaction,
  doc: PMNode,
  schema: Schema,
  id: string,
): boolean {
  const startPos = findStartContentPos(doc);
  if (startPos === null) return false;
  const $start = doc.resolve(startPos);
  const after = $start.nodeAfter;
  if (after && isFrozenMarker(after)) return false;
  const marker = makeMarker(schema, id);
  if (!marker) return false;
  tr.insert(startPos, marker);
  setFreezeMeta(tr, { allowFrozenChanges: true });
  return true;
}

export function applyInsertEndMarker(
  tr: Transaction,
  doc: PMNode,
  schema: Schema,
  id: string,
): boolean {
  const endPos = findEndContentPos(doc);
  if (endPos === null) return false;
  const $end = doc.resolve(endPos);
  const before = $end.nodeBefore;
  if (before && isFrozenMarker(before)) return false;
  const marker = makeMarker(schema, id);
  if (!marker) return false;
  tr.insert(endPos, marker);
  setFreezeMeta(tr, { allowFrozenChanges: true });
  return true;
}

export function applyRemoveStartMarker(tr: Transaction, doc: PMNode): boolean {
  const startPos = findStartContentPos(doc);
  if (startPos === null) return false;
  const $start = doc.resolve(startPos);
  const after = $start.nodeAfter;
  if (!after || !isFrozenMarker(after)) return false;
  tr.delete(startPos, startPos + after.nodeSize);
  setFreezeMeta(tr, { allowFrozenChanges: true });
  return true;
}

export function applyRemoveEndMarker(tr: Transaction, doc: PMNode): boolean {
  const endPos = findEndContentPos(doc);
  if (endPos === null) return false;
  const $end = doc.resolve(endPos);
  const before = $end.nodeBefore;
  if (!before || !isFrozenMarker(before)) return false;
  tr.delete(endPos - before.nodeSize, endPos);
  setFreezeMeta(tr, { allowFrozenChanges: true });
  return true;
}

// ---------------------------------------------------------------------------
// PM-style commands. These are thin wrappers over the apply* helpers.

export const toggleFreezeMode: Command = (state, dispatch) => {
  if (dispatch) {
    const cur = freezePluginKey.getState(state)?.freezeMode ?? false;
    const tr = state.tr;
    applySetFreezeMode(tr, !cur);
    dispatch(tr);
  }
  return true;
};

export function setFreezeMode(value: boolean): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr;
      applySetFreezeMode(tr, value);
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Insert a new frozen node carrying the given text at the current cursor.
 * If the selection is non-empty, it is replaced.
 */
export function addFrozen(text: string, options: CommandOptions = {}): Command {
  return (state, dispatch) => {
    if (text.length === 0) return false;
    if (!getFrozenType(state)) return false;
    if (dispatch) {
      const id = (options.generateId ?? defaultGenerateId)();
      const tr = state.tr;
      applyAddFrozen(tr, state.schema, text, id);
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Wrap the selected content in a single frozen node. Marks already on the
 * selected text (bold, italic, etc.) are preserved inside the new frozen.
 * Returns false when the selection is empty or spans multiple blocks.
 */
export function freezeSelection(options: CommandOptions = {}): Command {
  return (state, dispatch) => {
    if (!getFrozenType(state)) return false;
    if (!canFreezeRange(state.doc, state.selection.from, state.selection.to)) {
      return false;
    }
    if (dispatch) {
      const id = (options.generateId ?? defaultGenerateId)();
      const tr = state.tr;
      applyFreezeSelection(tr, state, id);
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Unfreeze frozen nodes adjacent to the cursor or contained in the
 * selection. Each frozen is replaced with its inline content; empty
 * frozens (markers) are removed entirely. Returns false when there is
 * nothing to clear.
 */
export const clearFrozen: Command = (state, dispatch) => {
  if (findFrozenForClear(state).length === 0) return false;
  if (dispatch) {
    const tr = state.tr;
    applyClearFrozen(tr, state);
    dispatch(tr);
  }
  return true;
};

/**
 * Toggle freezing on the current selection: clear when frozen content
 * is involved, otherwise wrap the selection in a frozen node.
 */
export function toggleFreeze(options: CommandOptions = {}): Command {
  return (state, dispatch) => {
    if (!getFrozenType(state)) return false;
    const hasFrozen = findFrozenForClear(state).length > 0;
    const canFreeze = canFreezeRange(state.doc, state.selection.from, state.selection.to);
    if (!hasFrozen && !canFreeze) return false;
    if (dispatch) {
      const id = (options.generateId ?? defaultGenerateId)();
      const tr = state.tr;
      applyToggleFreeze(tr, state, id);
      dispatch(tr);
    }
    return true;
  };
}

export function insertStartMarker(options: CommandOptions = {}): Command {
  return (state, dispatch) => {
    if (!getFrozenType(state)) return false;
    const startPos = findStartContentPos(state.doc);
    if (startPos === null) return false;
    const $start = state.doc.resolve(startPos);
    const after = $start.nodeAfter;
    if (after && isFrozenMarker(after)) return false;
    if (dispatch) {
      const id = (options.generateId ?? defaultGenerateId)();
      const tr = state.tr;
      applyInsertStartMarker(tr, state.doc, state.schema, id);
      dispatch(tr);
    }
    return true;
  };
}

export function insertEndMarker(options: CommandOptions = {}): Command {
  return (state, dispatch) => {
    if (!getFrozenType(state)) return false;
    const endPos = findEndContentPos(state.doc);
    if (endPos === null) return false;
    const $end = state.doc.resolve(endPos);
    const before = $end.nodeBefore;
    if (before && isFrozenMarker(before)) return false;
    if (dispatch) {
      const id = (options.generateId ?? defaultGenerateId)();
      const tr = state.tr;
      applyInsertEndMarker(tr, state.doc, state.schema, id);
      dispatch(tr);
    }
    return true;
  };
}

export const removeStartMarker: Command = (state, dispatch) => {
  const startPos = findStartContentPos(state.doc);
  if (startPos === null) return false;
  const $start = state.doc.resolve(startPos);
  const after = $start.nodeAfter;
  if (!after || !isFrozenMarker(after)) return false;
  if (dispatch) {
    const tr = state.tr;
    applyRemoveStartMarker(tr, state.doc);
    dispatch(tr);
  }
  return true;
};

export const removeEndMarker: Command = (state, dispatch) => {
  const endPos = findEndContentPos(state.doc);
  if (endPos === null) return false;
  const $end = state.doc.resolve(endPos);
  const before = $end.nodeBefore;
  if (!before || !isFrozenMarker(before)) return false;
  if (dispatch) {
    const tr = state.tr;
    applyRemoveEndMarker(tr, state.doc);
    dispatch(tr);
  }
  return true;
};

export function selectionTouchesFrozen(state: EditorState): boolean {
  const { from, to, empty } = state.selection;
  if (!empty) return findFrozenInRange(state.doc, from, to) !== null;
  const $from = state.selection.$from;
  return (
    isFrozenNode($from.nodeBefore) ||
    isFrozenNode($from.nodeAfter) ||
    $from.parent.type.name === FROZEN_NODE_NAME
  );
}

export function canFreezeSelection(state: EditorState): boolean {
  if (!getFrozenType(state)) return false;
  const { selection } = state;
  if (selection.empty) return false;
  if (!isFreezeModeOn(state)) return true;
  return findFrozenInRange(state.doc, selection.from, selection.to) === null;
}

/**
 * Returns true when the document is already prefixed with a boundary
 * marker — i.e. the leftmost inline node of the leftmost text container
 * is an empty frozen. Useful for menu logic: gate the "Add start marker"
 * button on `!hasStartMarker(state)`.
 */
export function hasStartMarker(state: EditorState): boolean {
  const startPos = findStartContentPos(state.doc);
  if (startPos === null) return false;
  const after = state.doc.resolve(startPos).nodeAfter;
  return Boolean(after && isFrozenMarker(after));
}

/** Symmetric to {@link hasStartMarker}. */
export function hasEndMarker(state: EditorState): boolean {
  const endPos = findEndContentPos(state.doc);
  if (endPos === null) return false;
  const before = state.doc.resolve(endPos).nodeBefore;
  return Boolean(before && isFrozenMarker(before));
}

/**
 * Extract the text content of every frozen node, keyed by id. Useful for
 * persisting/inspecting frozen sections outside the editor.
 */
export function getFrozenTextById(state: EditorState): Map<string, string> {
  const map = new Map<string, string>();
  state.doc.descendants((node) => {
    if (isFrozenNode(node)) {
      const id = (node.attrs as FrozenAttrs).id;
      if (id) map.set(id, node.textContent);
      return false;
    }
    return true;
  });
  return map;
}

/** Construct a frozen-as-Slice helper. Used by tests and the example. */
export function buildFrozenFragment(state: EditorState, text: string, id?: string): Slice | null {
  const type = getFrozenType(state);
  if (!type) return null;
  const node = type.create(
    { id: id ?? defaultGenerateId() } satisfies FrozenAttrs,
    text.length > 0 ? [state.schema.text(text)] : Fragment.empty,
  );
  return new Slice(Fragment.from(node), 0, 0);
}

export const _commandInternals = { findStartContentPos, findEndContentPos };
