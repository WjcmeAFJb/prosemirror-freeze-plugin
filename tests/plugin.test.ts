import { beforeEach, describe, expect, it } from 'vitest';

import {
  findFrozenInRange,
  freezePluginKey,
  isFreezeModeOn,
  selectionContainsFrozen,
  setFreezeMeta,
} from '../src/index.js';
import {
  applyTr,
  doc,
  findFrozen,
  frozen,
  makeState,
  marker,
  p,
  passesFilters,
  resetIds,
} from './helpers.js';

describe('freezePlugin: state', () => {
  beforeEach(resetIds);

  it('initializes with freezeMode true by default', () => {
    const state = makeState(doc(p('hello')));
    expect(isFreezeModeOn(state)).toBe(true);
  });

  it('can be initialized with freezeMode false', () => {
    const state = makeState(doc(p('hello')), { freeze: { freezeMode: false } });
    expect(isFreezeModeOn(state)).toBe(false);
  });

  it('updates freezeMode via setFreezeMode meta', () => {
    let state = makeState(doc(p('hello')));
    const tr = state.tr;
    setFreezeMeta(tr, { setFreezeMode: false });
    state = state.apply(tr);
    expect(isFreezeModeOn(state)).toBe(false);
  });

  it('exposes the plugin key for external lookups', () => {
    const state = makeState(doc(p('hello')));
    expect(freezePluginKey.getState(state)).toEqual({ freezeMode: true });
  });
});

describe('freezePlugin: filterTransaction — frozen preservation', () => {
  beforeEach(resetIds);

  it('blocks a transaction that removes a frozen node', () => {
    const f = frozen('hello', 'frz-1');
    const state = makeState(doc(p('a ', f, ' b')));
    const before = state.doc.toString();
    const result = applyTr(state, (tr) => {
      const frozenPos = findFrozen(state.doc)[0]!.pos;
      return tr.delete(frozenPos, frozenPos + f.nodeSize);
    });
    expect(result.applied).toBe(false);
    expect(result.state.doc.toString()).toBe(before);
  });

  it('allows removal when allowFrozenChanges meta is set', () => {
    const f = frozen('hello', 'frz-1');
    const state = makeState(doc(p('a ', f, ' b')));
    const result = applyTr(state, (tr) => {
      const frozenPos = findFrozen(state.doc)[0]!.pos;
      tr.delete(frozenPos, frozenPos + f.nodeSize);
      setFreezeMeta(tr, { allowFrozenChanges: true });
      return tr;
    });
    expect(result.applied).toBe(true);
    expect(findFrozen(result.state.doc)).toHaveLength(0);
  });

  it('blocks a partial overlap that removes the frozen node', () => {
    const f = frozen('hello', 'frz-1');
    const state = makeState(doc(p('aa ', f, ' bb')));
    const frozenPos = findFrozen(state.doc)[0]!.pos;
    const result = applyTr(state, (tr) => tr.delete(frozenPos - 1, frozenPos + f.nodeSize + 1));
    expect(result.applied).toBe(false);
  });

  it('blocks attempts to mutate a frozen node textContent', () => {
    const f = frozen('hello', 'frz-1');
    const state = makeState(doc(p('x ', f)));
    const frozenPos = findFrozen(state.doc)[0]!.pos;
    // Replace the inner text "hello" with "mutated".
    const result = applyTr(state, (tr) =>
      tr.replaceWith(frozenPos + 1, frozenPos + f.nodeSize - 1, state.schema.text('mutated')),
    );
    expect(result.applied).toBe(false);
  });

  it('preserves multiple frozen nodes — removal of any one is blocked', () => {
    const f1 = frozen('one', 'a');
    const f2 = frozen('two', 'b');
    const state = makeState(doc(p(f1, ' middle ', f2)));
    const positions = findFrozen(state.doc);
    const f1Pos = positions[0]!.pos;
    const result = applyTr(state, (tr) => tr.delete(f1Pos, f1Pos + f1.nodeSize));
    expect(result.applied).toBe(false);
  });

  it('allows insertion of a new frozen node', () => {
    const f1 = frozen('keeper', 'a');
    const state = makeState(doc(p(f1, ' middle')));
    const result = applyTr(state, (tr) => tr.insert(0, frozen('appended', 'b')));
    expect(result.applied).toBe(true);
    expect(findFrozen(result.state.doc)).toHaveLength(2);
  });

  it('blocks transactions when freezeMode is on, allows when off', () => {
    const f = frozen('protected', 'a');
    let state = makeState(doc(p('a ', f)), { freeze: { freezeMode: true } });
    const frozenPos = findFrozen(state.doc)[0]!.pos;
    const blocked = applyTr(state, (tr) => tr.delete(frozenPos, frozenPos + f.nodeSize));
    expect(blocked.applied).toBe(false);

    const tr = state.tr;
    setFreezeMeta(tr, { setFreezeMode: false });
    state = state.apply(tr);
    const allowed = applyTr(state, (innerTr) => innerTr.delete(frozenPos, frozenPos + f.nodeSize));
    expect(allowed.applied).toBe(true);
    expect(findFrozen(allowed.state.doc)).toHaveLength(0);
  });

  it('allows editing inside frozen text when freezeMode is off', () => {
    const f = frozen('hello', 'frz-1');
    let state = makeState(doc(p(f)), { freeze: { freezeMode: false } });
    const frozenPos = findFrozen(state.doc)[0]!.pos;
    // Insert "X" inside the frozen, between 'h' and 'e'.
    const result = applyTr(state, (tr) => tr.insertText('X', frozenPos + 2));
    expect(result.applied).toBe(true);
    expect(findFrozen(result.state.doc)[0]!.node.textContent).toBe('hXello');
    state = result.state;
  });
});

describe('freezePlugin: filterTransaction — boundary rule', () => {
  beforeEach(resetIds);

  it('blocks insertion at the start when doc starts with non-marker frozen', () => {
    const f = frozen('start', 'a');
    const state = makeState(doc(p(f, ' tail')));
    const result = applyTr(state, (tr) => tr.insertText('X', 1));
    expect(result.applied).toBe(false);
  });

  it('blocks insertion at the end when doc ends with non-marker frozen', () => {
    const f = frozen('end', 'a');
    const state = makeState(doc(p('head ', f)));
    const endPos = state.doc.content.size - 1;
    const result = applyTr(state, (tr) => tr.insertText('X', endPos));
    expect(result.applied).toBe(false);
  });

  it('allows insertion in the slit between two adjacent frozen nodes', () => {
    const f1 = frozen('one', 'a');
    const f2 = frozen('two', 'b');
    const state = makeState(doc(p(f1, f2)));
    const slitPos = 1 + f1.nodeSize;
    const result = applyTr(state, (tr) => tr.insertText('SLIT', slitPos));
    expect(result.applied).toBe(true);
    const para = result.state.doc.firstChild!;
    expect(para.childCount).toBe(3);
    expect(para.child(0).textContent).toBe('one');
    expect(para.child(1).text).toBe('SLIT');
    expect(para.child(2).textContent).toBe('two');
  });

  it('allows insertion at the start when a marker is present', () => {
    const m = marker('m1');
    const f = frozen('content', 'f1');
    const state = makeState(doc(p(m, f)));
    const result = applyTr(state, (tr) => tr.insertText('X', 1));
    expect(result.applied).toBe(true);
  });

  it('allows insertion at the end when a marker is present', () => {
    const f = frozen('content', 'f1');
    const m = marker('m1');
    const state = makeState(doc(p(f, m)));
    const endPos = state.doc.content.size - 1;
    const result = applyTr(state, (tr) => tr.insertText('X', endPos));
    expect(result.applied).toBe(true);
  });

  it('allows insertion between frozen and trailing marker (slit)', () => {
    const f = frozen('content', 'f1');
    const m = marker('m1');
    const state = makeState(doc(p(f, m)));
    // Position right after frozen, before marker.
    const slitPos = 1 + f.nodeSize;
    const result = applyTr(state, (tr) => tr.insertText('SLIT', slitPos));
    expect(result.applied).toBe(true);
    const para = result.state.doc.firstChild!;
    expect(para.child(0).textContent).toBe('content');
    expect(para.child(1).text).toBe('SLIT');
    expect(para.child(2).textContent).toBe('');
  });

  it('allows free editing inside non-frozen text in the middle', () => {
    const f1 = frozen('a', 'a');
    const f2 = frozen('b', 'b');
    const state = makeState(doc(p(f1, ' middle ', f2)));
    // Position inside the middle text, after the leading space.
    const result = applyTr(state, (tr) => tr.insertText('X', 2 + f1.nodeSize));
    expect(result.applied).toBe(true);
  });

  it('allows insertion at the start of a doc that has no boundary frozen', () => {
    const state = makeState(doc(p('plain text')));
    const result = applyTr(state, (tr) => tr.insertText('X', 1));
    expect(result.applied).toBe(true);
  });

  it('allows api-driven start-marker insertion via allowFrozenChanges', () => {
    const f = frozen('start', 'a');
    const state = makeState(doc(p(f, ' tail')));
    const result = applyTr(state, (tr) => {
      tr.insert(1, marker('mk1'));
      setFreezeMeta(tr, { allowFrozenChanges: true });
      return tr;
    });
    expect(result.applied).toBe(true);
  });

  it('allows boundary-rule preserving insertions across multi-paragraph docs', () => {
    // Last paragraph ends with frozen + marker. Last frozen of doc is the
    // marker, so insertion at end should be allowed.
    const last = p(frozen('protected', 'p1'), marker('m1'));
    const document_ = doc(p('first'), last);
    const state = makeState(document_);
    const endPos = state.doc.content.size - 1;
    const result = applyTr(state, (tr) => tr.insertText('TAIL', endPos));
    expect(result.applied).toBe(true);
    const lastP = result.state.doc.lastChild!;
    expect(lastP.lastChild!.text).toBe('TAIL');
  });
});

describe('freezePlugin: filterTransaction — third-party plugins', () => {
  beforeEach(resetIds);

  it('blocks deletes coming from another plugin (no meta)', () => {
    const f = frozen('shielded', 'a');
    const state = makeState(doc(p('x ', f)));
    const frozenPos = findFrozen(state.doc)[0]!.pos;
    const tr = state.tr.delete(frozenPos, frozenPos + f.nodeSize);
    expect(passesFilters(state, tr)).toBe(false);
  });
});

describe('freezePlugin: helpers', () => {
  beforeEach(resetIds);

  it('selectionContainsFrozen detects ranges over frozen', () => {
    const f = frozen('shield', 'a');
    const document_ = doc(p('aa ', f, ' bb'));
    const state = makeState(document_, {
      selection: { from: 1, to: document_.content.size - 1 },
    });
    expect(selectionContainsFrozen(state)).toBe(true);
  });

  it('selectionContainsFrozen returns false for collapsed selection', () => {
    const f = frozen('shield', 'a');
    const state = makeState(doc(p('aa ', f, ' bb')), {
      selection: { from: 1 },
    });
    expect(selectionContainsFrozen(state)).toBe(false);
  });

  it('findFrozenInRange returns the first match', () => {
    const f1 = frozen('a', 'a');
    const f2 = frozen('b', 'b');
    const document_ = doc(p('x', f1, 'y', f2, 'z'));
    const match = findFrozenInRange(document_, 0, document_.content.size);
    expect(match).not.toBeNull();
    expect(match!.node.textContent).toBe('a');
  });

  it('findFrozenInRange returns null when no match', () => {
    const f1 = frozen('a', 'a');
    const document_ = doc(p('x', f1, 'y'));
    expect(findFrozenInRange(document_, 1, 2)).toBeNull();
  });
});
