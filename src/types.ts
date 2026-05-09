import type { Node as PMNode, NodeSpec } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';

export const FROZEN_NODE_NAME = 'frozen' as const;
export type FrozenNodeName = typeof FROZEN_NODE_NAME;

export interface FrozenAttrs {
  /** Stable, unique identifier. Used to track preservation across transactions. */
  id: string;
}

export interface FreezePluginOptions {
  /** Initial freezing-mode value. Defaults to true. */
  freezeMode?: boolean;
  /** ID generator. Defaults to a UUID-ish generator. */
  generateId?: () => string;
  /**
   * If true (default), block clipboard `cut` events when the selection contains
   * frozen content; the selection is left in place and nothing is copied.
   */
  blockCutOnFrozen?: boolean;
}

export interface FreezePluginState {
  freezeMode: boolean;
}

/** Meta payload attached to transactions to bypass freeze enforcement. */
export interface FreezeTransactionMeta {
  /** Allow modifications/removals of frozen nodes in this transaction. */
  allowFrozenChanges?: boolean;
  /** Allow inserting non-frozen content before/after the boundary frozen nodes. */
  allowBoundaryChange?: boolean;
  /** Set freezeMode to this value. */
  setFreezeMode?: boolean;
}

export type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

export interface FrozenNodeMatch {
  node: PMNode;
  pos: number;
  end: number;
}

export type FrozenSchemaSpec = NodeSpec & {
  attrs: { id: { default: string | null } };
};
