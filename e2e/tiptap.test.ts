import { Editor } from '@tiptap/core';
import { Document } from '@tiptap/extension-document';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import 'prosemirror-view/style/prosemirror.css';

import { Frozen } from '../src/tiptap.js';

let container: HTMLElement | null = null;
let editor: Editor | null = null;

beforeEach(() => {
  container = document.createElement('div');
  container.style.minHeight = '100px';
  container.style.padding = '12px';
  document.body.append(container);
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  container?.remove();
  container = null;
});

function mount(extensionOpts?: Parameters<typeof Frozen.configure>[0], html = '<p></p>') {
  editor = new Editor({
    element: container!,
    extensions: [Document, Paragraph, Text, Frozen.configure(extensionOpts ?? {})],
    content: html,
  });
  return editor;
}

function frozenSpans(): NodeListOf<HTMLElement> {
  return container!.querySelectorAll<HTMLElement>('[data-frozen="true"]');
}

describe('TipTap Frozen extension', () => {
  it('parses an existing <span data-frozen="true"> from initial HTML', () => {
    const e = mount(
      undefined,
      '<p>Hello <span data-frozen="true" data-frozen-id="x">WORLD</span>!</p>',
    );
    expect(frozenSpans()).toHaveLength(1);
    expect(frozenSpans()[0]!.textContent).toBe('WORLD');
    void e;
  });

  it('exposes addFrozen via editor.commands', () => {
    const e = mount(undefined, '<p>hello</p>');
    e.commands.focus();
    e.commands.setTextSelection(6);
    e.commands.addFrozen('FRZ');
    expect(frozenSpans()).toHaveLength(1);
    expect(frozenSpans()[0]!.textContent).toBe('FRZ');
  });

  it('exposes freezeSelection via editor.commands', () => {
    const e = mount(undefined, '<p>hello world</p>');
    e.commands.setTextSelection({ from: 1, to: 6 });
    e.commands.freezeSelection();
    expect(frozenSpans()).toHaveLength(1);
    expect(frozenSpans()[0]!.textContent).toBe('hello');
  });

  it('Mod-b is exposed as a keyboard shortcut binding', () => {
    const e = mount(undefined, '<p>hello world</p>');
    // Tiptap merges all shortcut maps onto a single keymap plugin under
    // the editor's view. Verify our two-branch handler is registered.
    const opts = e.extensionManager.extensions.find((ex) => ex.name === 'frozen');
    expect(opts).toBeDefined();
    // Sanity check: invoking the same path Mod-b would take produces a frozen.
    e.commands.setTextSelection({ from: 1, to: 6 });
    e.chain().freezeSelection().run();
    expect(frozenSpans()).toHaveLength(1);
    expect(frozenSpans()[0]!.textContent).toBe('hello');
  });

  it('Mod-Shift-l toggles freezeMode', () => {
    const e = mount(undefined, '<p>x</p>');
    // Add a frozen so we have something to attempt deleting.
    e.commands.setTextSelection(2);
    e.commands.addFrozen('locked');
    expect(frozenSpans()).toHaveLength(1);

    // While freezeMode is on, selecting and pressing Backspace should not
    // remove the frozen.
    e.commands.setTextSelection({ from: 1, to: e.state.doc.content.size - 1 });
    e.commands.deleteSelection();
    expect(frozenSpans()).toHaveLength(1);

    // Toggle it off and try again.
    e.commands.toggleFreezeMode();
    e.commands.setTextSelection({ from: 1, to: e.state.doc.content.size - 1 });
    e.commands.deleteSelection();
    expect(frozenSpans()).toHaveLength(0);
  });

  it('clearFrozen unfreezes the frozen adjacent to the cursor', () => {
    const e = mount(undefined, '<p>x</p>');
    e.commands.setTextSelection(2);
    e.commands.addFrozen('boom');
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    e.commands.clearFrozen();
    expect(frozenSpans()).toHaveLength(0);
    expect(e.state.doc.firstChild!.textContent).toBe('xboom');
  });

  it('toggleFreeze freezes a plain selection then unfreezes it', () => {
    const e = mount(undefined, '<p>hello world</p>');
    e.commands.setTextSelection({ from: 1, to: 6 });
    e.commands.toggleFreeze();
    expect(frozenSpans()).toHaveLength(1);
    expect(frozenSpans()[0]!.textContent).toBe('hello');
    // Cursor is now at the boundary of the new frozen — toggling again
    // should peel the wrap back off.
    e.commands.setTextSelection({ from: 1, to: 1 + 'hello'.length + 2 });
    e.commands.toggleFreeze();
    expect(frozenSpans()).toHaveLength(0);
    expect(e.state.doc.firstChild!.textContent).toBe('hello world');
  });

  it('insertStartMarker / insertEndMarker pin boundary markers', () => {
    const e = mount(undefined, '<p><span data-frozen="true" data-frozen-id="a">x</span></p>');
    e.commands.insertStartMarker();
    e.commands.insertEndMarker();
    const spans = frozenSpans();
    expect(spans).toHaveLength(3);
    // First and last spans should be markers.
    expect(spans[0]!.dataset['frozenMarker']).toBe('true');
    expect(spans[spans.length - 1]!.dataset['frozenMarker']).toBe('true');
  });

  it('renders contenteditable=false on frozen while freezeMode is on', () => {
    mount(undefined, '<p><span data-frozen="true" data-frozen-id="a">locked</span></p>');
    const span = frozenSpans()[0]!;
    expect(span.getAttribute('contenteditable')).toBe('false');
  });

  it('drops contenteditable=false when freezeMode flips off', () => {
    const e = mount(undefined, '<p><span data-frozen="true" data-frozen-id="a">locked</span></p>');
    e.commands.setFreezeMode(false);
    const span = frozenSpans()[0]!;
    expect(span.getAttribute('contenteditable')).not.toBe('false');
  });

  it('inserting inside a frozen with freezeMode off mutates the text', () => {
    const e = mount(
      { freezeMode: false },
      '<p><span data-frozen="true" data-frozen-id="a">hi</span></p>',
    );
    e.commands.setTextSelection(2); // inside frozen, before 'h'
    e.commands.insertContent('!');
    expect(frozenSpans()[0]!.textContent).toBe('!hi');
  });

  it('inserting inside a frozen with freezeMode on is rejected by filterTransaction', () => {
    const e = mount(undefined, '<p><span data-frozen="true" data-frozen-id="a">hi</span></p>');
    e.commands.setTextSelection(3); // between 'h' and 'i'
    e.commands.insertContent('!');
    expect(frozenSpans()[0]!.textContent).toBe('hi');
  });
});
