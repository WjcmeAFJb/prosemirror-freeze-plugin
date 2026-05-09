import { baseKeymap } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { type Node as PMNode, Schema } from 'prosemirror-model';
import { EditorState, type Plugin, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import 'prosemirror-view/style/prosemirror.css';

import {
  type FreezePluginOptions,
  freezeKeymap,
  freezePlugin,
  frozenNodeSpec,
} from '../src/index.js';

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
    frozen: frozenNodeSpec,
  },
  marks: {
    strong: {
      toDOM: () => ['strong', 0],
      parseDOM: [{ tag: 'strong' }],
    },
    em: {
      toDOM: () => ['em', 0],
      parseDOM: [{ tag: 'em' }],
    },
  },
});

let idCounter = 0;
export const e2eId = (): string => {
  idCounter += 1;
  return `e2e-${idCounter}`;
};
export const resetE2eIds = (): void => {
  idCounter = 0;
};

export function f(text: string, id?: string): PMNode {
  const children = text.length > 0 ? [schema.text(text)] : [];
  return schema.nodes['frozen']!.create({ id: id ?? e2eId() }, children);
}
export function m(id?: string): PMNode {
  return f('', id);
}

export function paragraph(...children: (string | PMNode)[]): PMNode {
  const nodes: PMNode[] = [];
  for (const child of children) {
    if (typeof child === 'string') {
      if (child.length > 0) nodes.push(schema.text(child));
    } else {
      nodes.push(child);
    }
  }
  return schema.node('paragraph', null, nodes);
}

export function buildDoc(...paragraphs: PMNode[]): PMNode {
  return schema.node('doc', null, paragraphs);
}

export interface MountedEditor {
  view: EditorView;
  container: HTMLElement;
  destroy(): void;
}

interface MountOptions {
  freeze?: FreezePluginOptions;
  doc?: PMNode;
  withKeymap?: boolean;
}

export function mountEditor(options: MountOptions = {}): MountedEditor {
  const container = document.createElement('div');
  container.style.minHeight = '100px';
  container.style.padding = '12px';
  container.style.outline = '1px solid #ccc';
  document.body.append(container);

  const plugins: Plugin[] = [keymap(baseKeymap)];
  if (options.withKeymap !== false) {
    plugins.push(freezeKeymap());
  }
  plugins.push(freezePlugin(options.freeze ?? {}));

  const document_: PMNode = options.doc ?? buildDoc(paragraph(''));

  const state = EditorState.create({ doc: document_, plugins });
  const view = new EditorView(container, {
    state,
    dispatchTransaction(tr: Transaction) {
      const newState = view.state.apply(tr);
      view.updateState(newState);
    },
  });

  return {
    view,
    container,
    destroy(): void {
      view.destroy();
      container.remove();
    },
  };
}

export function placeCursor(view: EditorView, pos: number): void {
  view.focus();
  const $pos = view.state.doc.resolve(pos);
  const tr = view.state.tr.setSelection(TextSelection.between($pos, $pos));
  view.dispatch(tr);
}

export function selectRange(view: EditorView, from: number, to: number): void {
  view.focus();
  const $from = view.state.doc.resolve(from);
  const $to = view.state.doc.resolve(to);
  const tr = view.state.tr.setSelection(TextSelection.between($from, $to));
  view.dispatch(tr);
}

export function docText(view: EditorView): string {
  return view.state.doc.textContent;
}

export function inlineSnapshot(
  view: EditorView,
  paragraphIndex = 0,
): Array<{ kind: string; text: string }> {
  const out: Array<{ kind: string; text: string }> = [];
  view.state.doc.child(paragraphIndex).forEach((node) => {
    if (node.isText) {
      out.push({ kind: 'text', text: node.text ?? '' });
    } else if (node.type.name === 'frozen') {
      const text = node.textContent;
      out.push({ kind: text === '' ? 'marker' : 'frozen', text });
    }
  });
  return out;
}

export function frozenCount(view: EditorView): number {
  let n = 0;
  view.state.doc.descendants((node) => {
    if (node.type.name === 'frozen') {
      n += 1;
      return false;
    }
    return true;
  });
  return n;
}
