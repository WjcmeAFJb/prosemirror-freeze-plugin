import { userEvent } from '@vitest/browser/context';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addFrozen,
  clearFrozen,
  freezeSelection,
  insertEndMarker,
  insertStartMarker,
  selectionContainsFrozen,
  setFreezeMode,
  toggleFreezeMode,
} from '../src/index.js';
import {
  buildDoc,
  docText,
  f,
  frozenCount,
  inlineSnapshot,
  m,
  type MountedEditor,
  mountEditor,
  paragraph,
  placeCursor,
  resetE2eIds,
  selectRange,
} from './setup.js';

let editor: MountedEditor | null = null;

beforeEach(() => {
  resetE2eIds();
});
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mount(...args: Parameters<typeof mountEditor>): MountedEditor {
  editor = mountEditor(...args);
  return editor;
}

describe('typing protections', () => {
  it('cannot delete frozen text via Backspace at its right edge', async () => {
    const f1 = f('protected', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph('a ', f1)) });
    placeCursor(view, 3 + f1.nodeSize);
    expect(frozenCount(view)).toBe(1);
    await userEvent.keyboard('{Backspace}');
    expect(frozenCount(view)).toBe(1);
    expect(docText(view).startsWith('a ')).toBe(true);
  });

  it('cannot delete frozen text via Delete at its left edge', async () => {
    const f1 = f('protected', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph(f1, ' b')) });
    placeCursor(view, 1);
    await userEvent.keyboard('{Delete}');
    expect(frozenCount(view)).toBe(1);
  });

  it('cannot replace a selection that contains frozen text', async () => {
    const f1 = f('protected', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph('hi ', f1, ' bye')) });
    selectRange(view, 1, view.state.doc.content.size - 1);
    await userEvent.keyboard('X');
    expect(frozenCount(view)).toBe(1);
    const inline = inlineSnapshot(view);
    expect(inline.find((n) => n.kind === 'frozen')?.text).toBe('protected');
  });

  it('allows typing inside non-frozen text without affecting frozen content', async () => {
    const f1 = f('protected', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph('a ', f1, ' b')) });
    placeCursor(view, 2);
    await userEvent.keyboard('X');
    expect(docText(view)).toContain('aX');
    expect(frozenCount(view)).toBe(1);
  });

  it('allows typing in the slit between two adjacent frozen nodes', async () => {
    const f1 = f('one', 'f1');
    const f2 = f('two', 'f2');
    const { view } = mount({ doc: buildDoc(paragraph(f1, f2)) });
    placeCursor(view, 1 + f1.nodeSize);
    await userEvent.keyboard('SLIT');
    const inline = inlineSnapshot(view);
    expect(inline.map((n) => `${n.kind}:${n.text}`)).toEqual([
      'frozen:one',
      'text:SLIT',
      'frozen:two',
    ]);
  });
});

describe('boundary protection', () => {
  it('blocks typing at the start when doc starts with non-marker frozen', async () => {
    const f1 = f('first', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph(f1, ' tail')) });
    placeCursor(view, 1);
    await userEvent.keyboard('X');
    const inline = inlineSnapshot(view);
    expect(inline[0]!.kind).toBe('frozen');
    expect(inline[0]!.text).toBe('first');
  });

  it('allows typing at the start once a marker is present', async () => {
    const m1 = m('m1');
    const f1 = f('first', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph(m1, f1)) });
    placeCursor(view, 1);
    await userEvent.keyboard('X');
    const inline = inlineSnapshot(view);
    expect(inline.some((n) => n.kind === 'text' && n.text.includes('X'))).toBe(true);
  });

  it('blocks typing at the end when doc ends with non-marker frozen', async () => {
    const f1 = f('last', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph('head ', f1)) });
    placeCursor(view, view.state.doc.content.size - 1);
    await userEvent.keyboard('X');
    const inline = inlineSnapshot(view);
    expect(inline.at(-1)!.kind).toBe('frozen');
    expect(inline.at(-1)!.text).toBe('last');
  });

  it('allows typing at the end once an end marker is present', async () => {
    const f1 = f('last', 'f1');
    const m1 = m('m1');
    const { view } = mount({ doc: buildDoc(paragraph('head ', f1, m1)) });
    placeCursor(view, view.state.doc.content.size - 1);
    await userEvent.keyboard('Z');
    const inline = inlineSnapshot(view);
    expect(inline.some((n) => n.kind === 'text' && n.text.includes('Z'))).toBe(true);
  });

  it('allows typing in the slit between trailing frozen + marker', async () => {
    const f1 = f('payload', 'f1');
    const m1 = m('m1');
    const { view } = mount({ doc: buildDoc(paragraph(f1, m1)) });
    // Slit: right after frozen, before marker.
    placeCursor(view, 1 + f1.nodeSize);
    await userEvent.keyboard('GAP');
    const inline = inlineSnapshot(view);
    expect(inline.map((n) => `${n.kind}:${n.text}`)).toEqual([
      'frozen:payload',
      'text:GAP',
      'marker:',
    ]);
  });

  it('multi-paragraph: insertion at end of last paragraph (with trailing marker) is allowed', async () => {
    const f1 = f('last', 'f1');
    const m1 = m('m1');
    const { view } = mount({
      doc: buildDoc(paragraph('alpha'), paragraph('beta ', f1, m1)),
    });
    placeCursor(view, view.state.doc.content.size - 1);
    await userEvent.keyboard('TAIL');
    const lastInline = inlineSnapshot(view, 1);
    expect(lastInline.some((n) => n.text === 'TAIL')).toBe(true);
  });
});

describe('cut prevention', () => {
  it('cancels a cut when the selection contains frozen content', () => {
    const f1 = f('cant cut me', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph('a ', f1, ' b')) });
    selectRange(view, 1, view.state.doc.content.size - 1);
    expect(selectionContainsFrozen(view.state)).toBe(true);

    const event = new Event('cut', { bubbles: true, cancelable: true });
    view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(frozenCount(view)).toBe(1);
  });

  it('allows a cut when no frozen is selected', () => {
    const f1 = f('safe', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph('a ', f1, ' b')) });
    selectRange(view, 1, 2);
    const event = new Event('cut', { bubbles: true, cancelable: true });
    view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('API commands', () => {
  it('addFrozen inserts a frozen node at the cursor', () => {
    const { view } = mount({ doc: buildDoc(paragraph('hello')) });
    placeCursor(view, 6);
    addFrozen('FRZ')(view.state, view.dispatch.bind(view));
    const inline = inlineSnapshot(view);
    expect(inline.some((n) => n.kind === 'frozen' && n.text === 'FRZ')).toBe(true);
  });

  it('freezeSelection wraps selected text', () => {
    const { view } = mount({ doc: buildDoc(paragraph('hello world')) });
    selectRange(view, 1, 6);
    freezeSelection()(view.state, view.dispatch.bind(view));
    const inline = inlineSnapshot(view);
    expect(inline[0]!.kind).toBe('frozen');
    expect(inline[0]!.text).toBe('hello');
  });

  it('clearFrozen unfreezes the frozen adjacent to the cursor', () => {
    const f1 = f('zap', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph('x', f1, 'y')) });
    placeCursor(view, 2 + f1.nodeSize);
    clearFrozen(view.state, view.dispatch.bind(view));
    expect(frozenCount(view)).toBe(0);
    // The frozen text "zap" survives as plain text.
    expect(docText(view)).toBe('xzapy');
  });

  it('insertStartMarker prepends a boundary marker', () => {
    const f1 = f('content', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph(f1)) });
    insertStartMarker()(view.state, view.dispatch.bind(view));
    const inline = inlineSnapshot(view);
    expect(inline[0]!.kind).toBe('marker');
    expect(inline[1]!.kind).toBe('frozen');
  });

  it('insertEndMarker appends a boundary marker', () => {
    const f1 = f('content', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph(f1)) });
    insertEndMarker()(view.state, view.dispatch.bind(view));
    const inline = inlineSnapshot(view);
    expect(inline.at(-1)!.kind).toBe('marker');
  });

  it('toggleFreezeMode unblocks deletions when off', async () => {
    const f1 = f('removable', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph(f1)) });
    toggleFreezeMode(view.state, view.dispatch.bind(view));
    selectRange(view, 1, view.state.doc.content.size - 1);
    await userEvent.keyboard('{Backspace}');
    expect(frozenCount(view)).toBe(0);
  });

  it('setFreezeMode round-trip leaves frozen nodes intact', () => {
    const f1 = f('x', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph(f1)) });
    setFreezeMode(false)(view.state, view.dispatch.bind(view));
    setFreezeMode(true)(view.state, view.dispatch.bind(view));
    expect(frozenCount(view)).toBe(1);
  });
});

describe('editing mode (freezeMode = false)', () => {
  it('lets the user type inside a frozen node when freezeMode is off', async () => {
    const f1 = f('hello', 'f1');
    const { view } = mount({
      doc: buildDoc(paragraph(f1)),
      freeze: { freezeMode: false },
    });
    // Cursor between 'h' and 'e' inside the frozen.
    placeCursor(view, 3); // between 'h' and 'e' inside the frozen
    view.focus();
    await userEvent.keyboard('X');
    const inline = inlineSnapshot(view);
    expect(inline[0]!.kind).toBe('frozen');
    expect(inline[0]!.text).toBe('hXello');
  });

  it('blocks the same edit again once freezeMode is turned back on', async () => {
    const f1 = f('hello', 'f1');
    const { view } = mount({
      doc: buildDoc(paragraph(f1)),
      freeze: { freezeMode: false },
    });
    placeCursor(view, 3);
    await userEvent.keyboard('X'); // mutates the frozen → "hXello"
    setFreezeMode(true)(view.state, view.dispatch.bind(view));
    placeCursor(view, 3);
    await userEvent.keyboard('Y'); // should be rejected now
    const inline = inlineSnapshot(view);
    expect(inline[0]!.text).toBe('hXello');
  });
});

describe('keymap (Mod-b)', () => {
  it('Mod+B freezes the current selection', async () => {
    const { view } = mount({ doc: buildDoc(paragraph('hello world')) });
    selectRange(view, 1, 6);
    await userEvent.keyboard('{Control>}b{/Control}');
    const inline = inlineSnapshot(view);
    expect(inline[0]!.kind).toBe('frozen');
    expect(inline[0]!.text).toBe('hello');
  });

  it('Mod+B on a cursor adjacent to frozen unfreezes (preserves text)', async () => {
    const f1 = f('boom', 'f1');
    const { view } = mount({ doc: buildDoc(paragraph('x', f1, 'y')) });
    placeCursor(view, 2 + f1.nodeSize);
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(frozenCount(view)).toBe(0);
    // Text content survives.
    expect(docText(view)).toBe('xboomy');
  });
});

describe('rendering', () => {
  it('renders frozen as a span with data-frozen attribute', () => {
    const f1 = f('display', 'f1');
    const { container } = mount({ doc: buildDoc(paragraph(f1)) });
    const span = container.querySelector('[data-frozen="true"]');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('display');
  });

  it('renders contenteditable=false on frozen when freezeMode is on', () => {
    const f1 = f('locked', 'f1');
    const { container } = mount({ doc: buildDoc(paragraph(f1)) });
    const span = container.querySelector('[data-frozen="true"]');
    expect(span!.getAttribute('contenteditable')).toBe('false');
  });

  it('removes contenteditable=false when freezeMode flips off', () => {
    const f1 = f('locked', 'f1');
    const { view, container } = mount({ doc: buildDoc(paragraph(f1)) });
    setFreezeMode(false)(view.state, view.dispatch.bind(view));
    const span = container.querySelector('[data-frozen="true"]');
    expect(span!.getAttribute('contenteditable')).not.toBe('false');
  });

  it('marker is rendered with data-frozen-marker', () => {
    const m1 = m('m1');
    const { container } = mount({ doc: buildDoc(paragraph(m1)) });
    const marker = container.querySelector('[data-frozen-marker="true"]');
    expect(marker).not.toBeNull();
  });
});
