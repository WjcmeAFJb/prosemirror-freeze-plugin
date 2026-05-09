import { type Mark, type Node as PMNode, Schema } from 'prosemirror-model';
import { EditorState, type Plugin, TextSelection, type Transaction } from 'prosemirror-state';

import { type FreezePluginOptions, freezePlugin, frozenNodeSpec } from '../src/index.js';

/**
 * A small schema with paragraph/text/frozen + an atom block (`hr`) for
 * exercising boundary code paths that involve atom blocks.
 */
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    blockquote: {
      content: 'block+',
      group: 'block',
      toDOM: () => ['blockquote', 0],
      parseDOM: [{ tag: 'blockquote' }],
    },
    horizontal_rule: {
      group: 'block',
      atom: true,
      toDOM: () => ['hr'],
      parseDOM: [{ tag: 'hr' }],
    },
    text: { group: 'inline' },
    frozen: frozenNodeSpec,
  },
  marks: {
    em: {
      toDOM: () => ['em', 0],
      parseDOM: [{ tag: 'em' }],
    },
    strong: {
      toDOM: () => ['strong', 0],
      parseDOM: [{ tag: 'strong' }],
    },
  },
});

let idCounter = 0;
export function nextId(): string {
  idCounter += 1;
  return `id-${idCounter.toString().padStart(4, '0')}`;
}
export function resetIds(): void {
  idCounter = 0;
}

export function frozen(text: string, id?: string): PMNode {
  const children = text.length > 0 ? [schema.text(text)] : [];
  return schema.nodes.frozen!.create({ id: id ?? nextId() }, children);
}

export function marker(id?: string): PMNode {
  return frozen('', id);
}

export function p(...content: (PMNode | string | (PMNode | string)[])[]): PMNode {
  const nodes: PMNode[] = [];
  for (const item of content.flat()) {
    if (typeof item === 'string') {
      if (item.length > 0) nodes.push(schema.text(item));
    } else {
      nodes.push(item);
    }
  }
  return schema.nodes.paragraph!.create(null, nodes);
}

export function pWithMarks(marks: Mark[], ...content: (PMNode | string)[]): PMNode {
  const nodes: PMNode[] = [];
  for (const item of content) {
    if (typeof item === 'string') {
      if (item.length > 0) nodes.push(schema.text(item, marks));
    } else {
      nodes.push(item);
    }
  }
  return schema.nodes.paragraph!.create(null, nodes);
}

export function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc!.create(null, blocks);
}

export function makeState(
  document_: PMNode,
  options: {
    plugins?: Plugin[];
    selection?: { from: number; to?: number };
    freeze?: FreezePluginOptions;
  } = {},
): EditorState {
  const plugins = options.plugins ?? [freezePlugin(options.freeze ?? {})];
  let selection;
  if (options.selection) {
    const { from, to = from } = options.selection;
    selection = TextSelection.create(document_, from, to);
  }
  return EditorState.create({ doc: document_, plugins, selection });
}

export interface DispatchResult {
  applied: boolean;
  state: EditorState;
}

type Filter = (tr: Transaction, state: EditorState) => boolean;

function getFilter(plugin: Plugin): Filter | undefined {
  return (plugin.spec as { filterTransaction?: Filter }).filterTransaction;
}

export function passesFilters(state: EditorState, tr: Transaction): boolean {
  return state.plugins.every((plugin) => {
    const filter = getFilter(plugin);
    return filter ? filter(tr, state) : true;
  });
}

export function applyTr(
  state: EditorState,
  buildTr: (tr: Transaction) => Transaction,
): DispatchResult {
  const tr = buildTr(state.tr);
  if (!passesFilters(state, tr)) return { applied: false, state };
  return { applied: true, state: state.apply(tr) };
}

export function runCommand(
  state: EditorState,
  command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean,
): DispatchResult {
  let applied = false;
  let next = state;
  const can = command(state, (tr) => {
    if (!passesFilters(state, tr)) return;
    applied = true;
    next = state.apply(tr);
  });
  if (!can) return { applied: false, state };
  return { applied, state: next };
}

export function findFrozen(document_: PMNode): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  document_.descendants((node, pos) => {
    if (node.type.name === 'frozen') {
      out.push({ node, pos });
      return false;
    }
    return true;
  });
  return out;
}
