import type { Node as PMNode, NodeSpec, Schema } from 'prosemirror-model';

import { defaultGenerateId } from './id.js';
import { FROZEN_NODE_NAME, type FrozenAttrs } from './types.js';

/**
 * NodeSpec for the `frozen` inline node.
 *
 * The text lives in the node's content (text children) rather than in an
 * attribute, so the node can be rendered with a real DOM content hole and
 * become editable in-place when the plugin is in non-freeze mode. Bold,
 * italic, and any other inline mark a host application registers can be
 * applied to the text inside.
 *
 * The node is intentionally **not** an atom: when the plugin is in freeze
 * mode it locks the rendered DOM via a `contenteditable="false"` decoration
 * (and the filterTransaction hook), but in non-freeze mode the cursor can
 * land inside and the text can be edited like any other inline content.
 *
 * Two adjacent frozen nodes never merge because each carries a stable
 * unique `id` attribute — and because the freeze model uses *nodes*, not
 * marks, ProseMirror never coalesces them either way.
 *
 * An empty frozen (`content.size === 0`) is the boundary marker described
 * in the README: it serializes to `~~~~` and exists to open up insertion
 * at the document boundary.
 */
export const frozenNodeSpec: NodeSpec = {
  inline: true,
  group: 'inline',
  content: 'text*',
  selectable: true,
  draggable: false,
  attrs: {
    id: { default: '' },
  },
  toDOM(node: PMNode) {
    const { id } = node.attrs as FrozenAttrs;
    const isMarker = node.content.size === 0;
    return [
      'span',
      {
        class: isMarker ? 'pm-frozen pm-frozen-marker' : 'pm-frozen',
        'data-frozen': 'true',
        'data-frozen-id': id,
        'data-frozen-marker': isMarker ? 'true' : 'false',
      },
      0,
    ];
  },
  parseDOM: [
    {
      tag: 'span[data-frozen="true"]',
      getAttrs(dom: HTMLElement | string): { id: string } | false {
        if (typeof dom === 'string') return false;
        const id = dom.dataset['frozenId'] ?? defaultGenerateId();
        return { id };
      },
    },
  ],
};

export function hasFrozenNode(schema: Schema): boolean {
  return Object.prototype.hasOwnProperty.call(schema.nodes, FROZEN_NODE_NAME);
}

/**
 * Convenience: extends a node spec map with the frozen node spec under the
 * canonical name. Throws if the name is already taken — callers can register
 * the spec manually under a different name if they need to.
 */
export function addFrozenToNodes<T extends Record<string, NodeSpec>>(
  nodes: T,
): T & { frozen: NodeSpec } {
  if (Object.prototype.hasOwnProperty.call(nodes, FROZEN_NODE_NAME)) {
    throw new Error(
      `Node name "${FROZEN_NODE_NAME}" already registered; remove it before calling addFrozenToNodes or register the spec manually.`,
    );
  }
  return { ...nodes, [FROZEN_NODE_NAME]: frozenNodeSpec } as T & {
    frozen: NodeSpec;
  };
}

export function isFrozenNode(node: PMNode | null | undefined): boolean {
  return node?.type.name === FROZEN_NODE_NAME;
}

export function isFrozenMarker(node: PMNode | null | undefined): boolean {
  return isFrozenNode(node) && node!.content.size === 0;
}

/** Concatenated text of a frozen node — equivalent to `node.textContent`. */
export function frozenText(node: PMNode): string {
  return node.textContent;
}
