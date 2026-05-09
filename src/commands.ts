import { Fragment, type Node as PMNode, type NodeType, Slice } from 'prosemirror-model';
import { type EditorState, type Transaction } from 'prosemirror-state';

import { defaultGenerateId } from './id.js';
import { findFrozenInRange, freezePluginKey, isFreezeModeOn, setFreezeMeta } from './plugin.js';
import { isFrozenMarker, isFrozenNode } from './schema.js';
import { type Command, FROZEN_NODE_NAME, type FrozenAttrs } from './types.js';

interface CommandOptions {
  generateId?: () => string;
}

function getFrozenType(state: EditorState): NodeType | null {
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

export const toggleFreezeMode: Command = (state, dispatch) => {
  if (dispatch) {
    const cur = freezePluginKey.getState(state)?.freezeMode ?? false;
    const tr = state.tr;
    setFreezeMeta(tr, { setFreezeMode: !cur });
    dispatch(tr);
  }
  return true;
};

export function setFreezeMode(value: boolean): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr;
      setFreezeMeta(tr, { setFreezeMode: value });
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Insert a new frozen node carrying the given text at the current cursor
 * position. If the selection is non-empty, it is replaced.
 */
export function addFrozen(text: string, options: CommandOptions = {}): Command {
  return (state, dispatch) => {
    const type = getFrozenType(state);
    if (!type) return false;
    if (text.length === 0) return false;

    if (dispatch) {
      const id = (options.generateId ?? defaultGenerateId)();
      const node = type.create({ id } satisfies FrozenAttrs, [state.schema.text(text)]);
      const tr = state.tr.replaceSelectionWith(node, false);
      tr.scrollIntoView();
      setFreezeMeta(tr, { allowFrozenChanges: true });
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
    const type = getFrozenType(state);
    if (!type) return false;
    const { from, to, empty } = state.selection;
    if (empty) return false;

    // Refuse selections that cross block boundaries — frozen is inline.
    const $from = state.doc.resolve(from);
    const $to = state.doc.resolve(to);
    if ($from.parent !== $to.parent || !$from.parent.isTextblock) return false;

    const slice = state.doc.slice(from, to);
    if (slice.content.size === 0) return false;

    // Reject if the slice already contains a frozen node — we'd lose its id.
    let containsFrozen = false;
    slice.content.descendants((n) => {
      if (isFrozenNode(n)) {
        containsFrozen = true;
        return false;
      }
      return true;
    });
    if (containsFrozen) return false;

    if (dispatch) {
      const id = (options.generateId ?? defaultGenerateId)();
      const frozen = type.create({ id } satisfies FrozenAttrs, slice.content);
      const tr = state.tr.replaceWith(from, to, frozen);
      tr.scrollIntoView();
      setFreezeMeta(tr, { allowFrozenChanges: true });
      dispatch(tr);
    }
    return true;
  };
}

interface FoundFrozen {
  node: PMNode;
  pos: number;
}

function findFrozenForClear(state: EditorState): FoundFrozen[] {
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
      // Cursor is inside a frozen node.
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
 * Remove frozen nodes adjacent to the cursor or contained in the
 * selection. If the cursor is in a slit between two frozen nodes, the
 * frozen *before* the cursor is removed (consistent with backspace
 * intuition). Returns false if there is nothing to remove.
 */
export const clearFrozen: Command = (state, dispatch) => {
  const targets = findFrozenForClear(state);
  if (targets.length === 0) return false;

  if (dispatch) {
    let tr: Transaction = state.tr;
    for (let i = targets.length - 1; i >= 0; i--) {
      const { node, pos } = targets[i]!;
      tr = tr.delete(pos, pos + node.nodeSize);
    }
    setFreezeMeta(tr, { allowFrozenChanges: true });
    dispatch(tr);
  }
  return true;
};

/**
 * Insert a boundary marker (an empty frozen node) at the very start of
 * the document, opening the start boundary for user insertion. No-op if
 * the document is already prefixed with a marker.
 */
export function insertStartMarker(options: CommandOptions = {}): Command {
  return (state, dispatch) => {
    const type = getFrozenType(state);
    if (!type) return false;
    const startPos = findStartContentPos(state.doc);
    if (startPos === null) return false;

    const $start = state.doc.resolve(startPos);
    const after = $start.nodeAfter;
    if (after && isFrozenMarker(after)) return false;

    if (dispatch) {
      const id = (options.generateId ?? defaultGenerateId)();
      const marker = type.create({ id } satisfies FrozenAttrs, Fragment.empty);
      const tr = state.tr.insert(startPos, marker);
      setFreezeMeta(tr, { allowFrozenChanges: true });
      dispatch(tr);
    }
    return true;
  };
}

export function insertEndMarker(options: CommandOptions = {}): Command {
  return (state, dispatch) => {
    const type = getFrozenType(state);
    if (!type) return false;
    const endPos = findEndContentPos(state.doc);
    if (endPos === null) return false;

    const $end = state.doc.resolve(endPos);
    const before = $end.nodeBefore;
    if (before && isFrozenMarker(before)) return false;

    if (dispatch) {
      const id = (options.generateId ?? defaultGenerateId)();
      const marker = type.create({ id } satisfies FrozenAttrs, Fragment.empty);
      const tr = state.tr.insert(endPos, marker);
      setFreezeMeta(tr, { allowFrozenChanges: true });
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
    const tr = state.tr.delete(startPos, startPos + after.nodeSize);
    setFreezeMeta(tr, { allowFrozenChanges: true });
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
    const tr = state.tr.delete(endPos - before.nodeSize, endPos);
    setFreezeMeta(tr, { allowFrozenChanges: true });
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

/** Construct a frozen-as-Fragment helper. Used by tests/the example. */
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
