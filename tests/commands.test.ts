import { beforeEach, describe, expect, it } from 'vitest';

import {
  addFrozen,
  canFreezeSelection,
  clearFrozen,
  freezeSelection,
  getFrozenTextById,
  insertEndMarker,
  insertStartMarker,
  isFreezeModeOn,
  removeEndMarker,
  removeStartMarker,
  selectionTouchesFrozen,
  setFreezeMode,
  toggleFreeze,
  toggleFreezeMode,
} from '../src/index.js';
import {
  doc,
  findFrozen,
  frozen,
  makeState,
  marker,
  p,
  resetIds,
  runCommand,
  schema,
} from './helpers.js';

describe('toggleFreezeMode / setFreezeMode', () => {
  beforeEach(resetIds);

  it('toggleFreezeMode flips the flag', () => {
    let state = makeState(doc(p('hi')));
    expect(isFreezeModeOn(state)).toBe(true);
    const r = runCommand(state, toggleFreezeMode);
    expect(r.applied).toBe(true);
    expect(isFreezeModeOn(r.state)).toBe(false);
    state = r.state;
    const r2 = runCommand(state, toggleFreezeMode);
    expect(isFreezeModeOn(r2.state)).toBe(true);
  });

  it('setFreezeMode(false) turns off the flag', () => {
    const state = makeState(doc(p('hi')));
    const r = runCommand(state, setFreezeMode(false));
    expect(r.applied).toBe(true);
    expect(isFreezeModeOn(r.state)).toBe(false);
  });

  it('setFreezeMode(true) is idempotent', () => {
    const state = makeState(doc(p('hi')));
    const r = runCommand(state, setFreezeMode(true));
    expect(r.applied).toBe(true);
    expect(isFreezeModeOn(r.state)).toBe(true);
  });
});

describe('addFrozen', () => {
  beforeEach(resetIds);

  it('inserts a frozen node at the cursor', () => {
    const state = makeState(doc(p('hello')), { selection: { from: 3 } });
    const r = runCommand(state, addFrozen('NEW'));
    expect(r.applied).toBe(true);
    const frz = findFrozen(r.state.doc);
    expect(frz).toHaveLength(1);
    expect(frz[0]!.node.textContent).toBe('NEW');
  });

  it('refuses empty text', () => {
    const state = makeState(doc(p('hello')), { selection: { from: 3 } });
    const r = runCommand(state, addFrozen(''));
    expect(r.applied).toBe(false);
  });

  it('replaces a non-empty selection with the frozen', () => {
    const state = makeState(doc(p('hello world')), {
      selection: { from: 1, to: 6 },
    });
    const r = runCommand(state, addFrozen('FRZ'));
    expect(r.applied).toBe(true);
    expect(findFrozen(r.state.doc)).toHaveLength(1);
  });

  it('uses a custom id generator when provided', () => {
    const state = makeState(doc(p('hi')), { selection: { from: 2 } });
    const r = runCommand(state, addFrozen('X', { generateId: () => 'custom-id' }));
    expect(findFrozen(r.state.doc)[0]!.node.attrs['id']).toBe('custom-id');
  });
});

describe('freezeSelection', () => {
  beforeEach(resetIds);

  it('wraps selected text in a frozen node', () => {
    const state = makeState(doc(p('hello world')), {
      selection: { from: 1, to: 6 },
    });
    const r = runCommand(state, freezeSelection());
    expect(r.applied).toBe(true);
    const frz = findFrozen(r.state.doc);
    expect(frz).toHaveLength(1);
    expect(frz[0]!.node.textContent).toBe('hello');
  });

  it('returns false on an empty selection', () => {
    const state = makeState(doc(p('hi')), { selection: { from: 2 } });
    const r = runCommand(state, freezeSelection());
    expect(r.applied).toBe(false);
  });

  it('refuses if the selection already contains a frozen node', () => {
    const f = frozen('x', 'a');
    const document_ = doc(p('hi ', f, ' there'));
    const state = makeState(document_, {
      selection: { from: 1, to: document_.content.size - 1 },
    });
    const r = runCommand(state, freezeSelection());
    expect(r.applied).toBe(false);
  });
});

describe('toggleFreeze', () => {
  beforeEach(resetIds);

  it('freezes a plain-text selection', () => {
    const state = makeState(doc(p('hello world')), {
      selection: { from: 1, to: 6 },
    });
    const r = runCommand(state, toggleFreeze());
    expect(r.applied).toBe(true);
    const frz = findFrozen(r.state.doc);
    expect(frz).toHaveLength(1);
    expect(frz[0]!.node.textContent).toBe('hello');
  });

  it('unfreezes when the cursor is adjacent to frozen', () => {
    const f = frozen('zap', 'a');
    const document_ = doc(p('x', f, 'y'));
    const state = makeState(document_, { selection: { from: 2 + f.nodeSize } });
    const r = runCommand(state, toggleFreeze());
    expect(r.applied).toBe(true);
    expect(findFrozen(r.state.doc)).toHaveLength(0);
    expect(r.state.doc.firstChild!.textContent).toBe('xzapy');
  });

  it('unfreezes when the selection covers a frozen', () => {
    const f = frozen('zap', 'a');
    const document_ = doc(p('x ', f, ' y'));
    const state = makeState(document_, {
      selection: { from: 1, to: document_.content.size - 1 },
    });
    const r = runCommand(state, toggleFreeze());
    expect(r.applied).toBe(true);
    expect(findFrozen(r.state.doc)).toHaveLength(0);
    expect(r.state.doc.firstChild!.textContent).toBe('x zap y');
  });

  it('returns false on an empty selection with no adjacent frozen', () => {
    const state = makeState(doc(p('plain')), { selection: { from: 2 } });
    const r = runCommand(state, toggleFreeze());
    expect(r.applied).toBe(false);
  });

  it('round-trips: freeze → toggleFreeze unfreezes back to plain text', () => {
    let state = makeState(doc(p('hello world')), {
      selection: { from: 1, to: 6 },
    });
    state = runCommand(state, toggleFreeze()).state; // freeze "hello"
    expect(findFrozen(state.doc)).toHaveLength(1);
    state = runCommand(state, toggleFreeze()).state; // unfreeze
    expect(findFrozen(state.doc)).toHaveLength(0);
    expect(state.doc.firstChild!.textContent).toBe('hello world');
  });
});

describe('clearFrozen (unfreeze)', () => {
  beforeEach(resetIds);

  it('replaces the frozen before a collapsed cursor with its text', () => {
    const f = frozen('zap', 'a');
    const document_ = doc(p('x ', f, ' y'));
    const cursorAfterFrozen = 2 + f.nodeSize + 1;
    const state = makeState(document_, {
      selection: { from: cursorAfterFrozen },
    });
    const r = runCommand(state, clearFrozen);
    expect(r.applied).toBe(true);
    expect(findFrozen(r.state.doc)).toHaveLength(0);
    expect(r.state.doc.firstChild!.textContent).toBe('x zap y');
  });

  it('replaces the frozen after a collapsed cursor with its text', () => {
    const f = frozen('zap', 'a');
    const document_ = doc(p(f, ' y'));
    const state = makeState(document_, { selection: { from: 1 } });
    const r = runCommand(state, clearFrozen);
    expect(r.applied).toBe(true);
    expect(findFrozen(r.state.doc)).toHaveLength(0);
    expect(r.state.doc.firstChild!.textContent).toBe('zap y');
  });

  it('unfreezes the surrounding frozen when the cursor is inside it', () => {
    const f = frozen('inside', 'a');
    const document_ = doc(p(f));
    const state = makeState(document_, { selection: { from: 2 } });
    const r = runCommand(state, clearFrozen);
    expect(r.applied).toBe(true);
    expect(findFrozen(r.state.doc)).toHaveLength(0);
    expect(r.state.doc.firstChild!.textContent).toBe('inside');
  });

  it('removes empty frozens (markers) entirely instead of unfreezing them', () => {
    const m = marker('m');
    const f = frozen('content', 'f');
    const document_ = doc(p(m, f));
    const state = makeState(document_, {
      selection: { from: 1, to: document_.content.size - 1 },
    });
    const r = runCommand(state, clearFrozen);
    expect(r.applied).toBe(true);
    expect(findFrozen(r.state.doc)).toHaveLength(0);
    expect(r.state.doc.firstChild!.textContent).toBe('content');
  });

  it('unfreezes all frozen nodes in a non-empty selection', () => {
    const f1 = frozen('one', 'a');
    const f2 = frozen('two', 'b');
    const document_ = doc(p(f1, ' middle ', f2));
    const state = makeState(document_, {
      selection: { from: 1, to: document_.content.size - 1 },
    });
    const r = runCommand(state, clearFrozen);
    expect(r.applied).toBe(true);
    expect(findFrozen(r.state.doc)).toHaveLength(0);
    expect(r.state.doc.firstChild!.textContent).toBe('one middle two');
  });

  it('returns false when there is no frozen to clear', () => {
    const state = makeState(doc(p('plain')), { selection: { from: 2 } });
    const r = runCommand(state, clearFrozen);
    expect(r.applied).toBe(false);
  });

  it('unfreezes the *before* node first when cursor is in a slit', () => {
    const f1 = frozen('a', 'id-a');
    const f2 = frozen('b', 'id-b');
    const document_ = doc(p(f1, f2));
    const state = makeState(document_, {
      selection: { from: 1 + f1.nodeSize },
    });
    const r = runCommand(state, clearFrozen);
    expect(r.applied).toBe(true);
    const remaining = findFrozen(r.state.doc);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.node.attrs['id']).toBe('id-b');
    expect(r.state.doc.firstChild!.textContent).toBe('ab');
  });

  it('preserves marks on the unfrozen text', () => {
    const strong = schema.marks['strong']!;
    const frozenType = schema.nodes['frozen']!;
    const inner = schema.text('bold', [strong.create()]);
    const f = frozenType.create({ id: 'a' }, [inner]);
    const document_ = schema.node('doc', null, [schema.node('paragraph', null, [f])]);
    const state = makeState(document_, { selection: { from: 1 } });
    const r = runCommand(state, clearFrozen);
    expect(r.applied).toBe(true);
    const text = r.state.doc.firstChild!.firstChild!;
    expect(text.text).toBe('bold');
    expect(text.marks.some((m) => m.type.name === 'strong')).toBe(true);
  });
});

describe('insertStartMarker / insertEndMarker', () => {
  beforeEach(resetIds);

  it('inserts a marker at the start of the document', () => {
    const f = frozen('content', 'a');
    const state = makeState(doc(p(f, ' tail')));
    const r = runCommand(state, insertStartMarker());
    expect(r.applied).toBe(true);
    const first = r.state.doc.firstChild!.firstChild!;
    expect(first.textContent).toBe('');
    expect(first.type.name).toBe('frozen');
  });

  it('insertStartMarker is a no-op if a marker already exists at the start', () => {
    const m = marker('m1');
    const f = frozen('content', 'a');
    const state = makeState(doc(p(m, f)));
    const r = runCommand(state, insertStartMarker());
    expect(r.applied).toBe(false);
  });

  it('inserts a marker at the end of the document', () => {
    const f = frozen('content', 'a');
    const state = makeState(doc(p('head ', f)));
    const r = runCommand(state, insertEndMarker());
    expect(r.applied).toBe(true);
    const last = r.state.doc.firstChild!.lastChild!;
    expect(last.textContent).toBe('');
    expect(last.type.name).toBe('frozen');
  });

  it('insertEndMarker is a no-op if a marker already exists at the end', () => {
    const f = frozen('content', 'a');
    const m = marker('m1');
    const state = makeState(doc(p(f, m)));
    const r = runCommand(state, insertEndMarker());
    expect(r.applied).toBe(false);
  });

  it('removeStartMarker removes the start marker', () => {
    const m = marker('m1');
    const f = frozen('c', 'a');
    const state = makeState(doc(p(m, f)));
    const r = runCommand(state, removeStartMarker);
    expect(r.applied).toBe(true);
    expect(findFrozen(r.state.doc)).toHaveLength(1);
    expect(findFrozen(r.state.doc)[0]!.node.textContent).toBe('c');
  });

  it('removeStartMarker is a no-op when there is no start marker', () => {
    const f = frozen('c', 'a');
    const state = makeState(doc(p(f)));
    const r = runCommand(state, removeStartMarker);
    expect(r.applied).toBe(false);
  });

  it('removeEndMarker removes the end marker', () => {
    const m = marker('m1');
    const f = frozen('c', 'a');
    const state = makeState(doc(p(f, m)));
    const r = runCommand(state, removeEndMarker);
    expect(r.applied).toBe(true);
    expect(findFrozen(r.state.doc)).toHaveLength(1);
    expect(findFrozen(r.state.doc)[0]!.node.textContent).toBe('c');
  });
});

describe('selectionTouchesFrozen / canFreezeSelection', () => {
  beforeEach(resetIds);

  it('selectionTouchesFrozen reports true when adjacent to frozen', () => {
    const f = frozen('x', 'a');
    const state = makeState(doc(p('hi ', f, ' there')), {
      selection: { from: 1 + 'hi '.length + 1 },
    });
    expect(selectionTouchesFrozen(state)).toBe(true);
  });

  it('selectionTouchesFrozen reports true when cursor is inside frozen', () => {
    const f = frozen('xyz', 'a');
    const state = makeState(doc(p(f)), { selection: { from: 2 } });
    expect(selectionTouchesFrozen(state)).toBe(true);
  });

  it('canFreezeSelection is false on empty selection', () => {
    const state = makeState(doc(p('plain')), { selection: { from: 2 } });
    expect(canFreezeSelection(state)).toBe(false);
  });

  it('canFreezeSelection is true on non-empty selection of plain text', () => {
    const state = makeState(doc(p('hello')), { selection: { from: 1, to: 4 } });
    expect(canFreezeSelection(state)).toBe(true);
  });

  it('canFreezeSelection is false when selection covers existing frozen', () => {
    const f = frozen('x', 'a');
    const document_ = doc(p('aa ', f, ' bb'));
    const state = makeState(document_, {
      selection: { from: 1, to: document_.content.size - 1 },
    });
    expect(canFreezeSelection(state)).toBe(false);
  });
});

describe('getFrozenTextById', () => {
  beforeEach(resetIds);

  it('returns a map of id → text for every frozen in the doc', () => {
    const f1 = frozen('one', 'a');
    const f2 = frozen('two', 'b');
    const m = marker('m');
    const state = makeState(doc(p(f1, ' middle ', f2, m)));
    const map = getFrozenTextById(state);
    expect([...map.entries()]).toEqual([
      ['a', 'one'],
      ['b', 'two'],
      ['m', ''],
    ]);
  });
});
