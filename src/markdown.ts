// markdown-it ships its types via `export = MarkdownIt` where MarkdownIt is
// both a class and a namespace. Importing it as a non-type default lets us
// reach into the namespace for `MarkdownIt.Options` etc.
import type MarkdownIt from 'markdown-it';
import type { MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node as PMNode } from 'prosemirror-model';

import { defaultGenerateId } from './id.js';
import type { FrozenAttrs } from './types.js';

/** Token type used by the markdown-it rule and the prosemirror-markdown parser. */
export const FROZEN_TOKEN = 'frozen_section';

const TILDE_CC = 0x7e; // '~'

interface InlineState {
  src: string;
  pos: number;
  posMax: number;
  md: MarkdownIt;
  push(type: string, tag: string, nesting: number): { content: string; markup: string };
}

interface BlockState {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  blkIndent: number;
  line: number;
  isEmpty(line: number): boolean;
  push(
    type: string,
    tag: string,
    nesting: number,
  ): {
    markup: string;
    map: [number, number];
    content: string;
    children: unknown[];
  };
  getLines(begin: number, end: number, indent: number, keepLastLF: boolean): string;
}

/**
 * markdown-it inline rule. Recognises `~~ ... ~~` and emits a pair of
 * `frozen_section_open` / `frozen_section_close` tokens with the inner
 * content tokenised via the standard inline parser — so emphasis, strong,
 * and other marks survive the round-trip when nested inside a frozen
 * section.
 *
 * Empty content (`~~~~`) is intentionally allowed — that is the boundary
 * marker form. Unmatched openers are ignored (no token).
 */
function frozenInlineRule(state: InlineState, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.codePointAt(start) !== TILDE_CC) return false;
  if (state.src.codePointAt(start + 1) !== TILDE_CC) return false;

  const closeIdx = state.src.indexOf('~~', start + 2);
  if (closeIdx === -1) return false;

  const slice = state.src.slice(start + 2, closeIdx);
  if (slice.includes('\n')) return false;

  if (silent) return true;

  const open = state.push(`${FROZEN_TOKEN}_open`, 'span', 1);
  open.markup = '~~';

  if (slice.length > 0) {
    // Recursively tokenise the inner content as inline so emphasis, code,
    // links etc. inside `~~ … ~~` are preserved.
    const savedPos = state.pos;
    const savedPosMax = state.posMax;
    state.pos = start + 2;
    state.posMax = closeIdx;
    state.md.inline.tokenize(state as unknown as Parameters<MarkdownIt['inline']['tokenize']>[0]);
    state.pos = savedPos;
    state.posMax = savedPosMax;
  }

  const close = state.push(`${FROZEN_TOKEN}_close`, 'span', -1);
  close.markup = '~~';

  state.pos = closeIdx + 2;
  return true;
}

/** Block-level rule that pre-empts `fence` for lines that start with `~~`. */
function freezeBlockRule(
  state: BlockState,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  if (state.src.codePointAt(start) !== TILDE_CC) return false;
  if (state.src.codePointAt(start + 1) !== TILDE_CC) return false;

  if (silent) return true;

  let nextLine = startLine + 1;
  while (nextLine < endLine && !state.isEmpty(nextLine)) {
    nextLine += 1;
  }
  state.line = nextLine;

  const open = state.push('paragraph_open', 'p', 1);
  open.markup = '';
  open.map = [startLine, nextLine];

  const inlineTok = state.push('inline', '', 0);
  inlineTok.content = state.getLines(startLine, nextLine, state.blkIndent, false).trim();
  inlineTok.map = [startLine, nextLine];
  inlineTok.children = [];

  const close = state.push('paragraph_close', 'p', -1);
  close.markup = '';
  close.map = [startLine, nextLine];
  return true;
}

const BLOCK_RULE_NAME = 'freeze_block';
const REGISTERED = Symbol.for('prosemirror-freeze-plugin/registered');

interface RulerInternals {
  __rules__: { name: string; fn: unknown }[];
}

function hasRule(ruler: { getRules: (n: string) => unknown[] }, name: string): boolean {
  const internals = ruler as unknown as RulerInternals;
  return Array.isArray(internals.__rules__)
    ? internals.__rules__.some((r) => r.name === name)
    : false;
}

/**
 * Apply the freeze inline + block rules to a markdown-it instance.
 * Idempotent — calling twice on the same instance is a no-op.
 */
export function markdownItFreezePlugin(md: MarkdownIt): void {
  const flagged = md as unknown as Record<symbol, boolean>;
  if (flagged[REGISTERED]) return;
  flagged[REGISTERED] = true;

  const beforeRule = hasRule(md.inline.ruler, 'strikethrough') ? 'strikethrough' : 'emphasis';
  md.inline.ruler.before(
    beforeRule,
    FROZEN_TOKEN,
    frozenInlineRule as unknown as Parameters<typeof md.inline.ruler.before>[2],
  );

  md.block.ruler.before(
    'fence',
    BLOCK_RULE_NAME,
    freezeBlockRule as unknown as Parameters<typeof md.block.ruler.before>[2],
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );
}

/**
 * Token-spec entry for `prosemirror-markdown`'s parser. Use it like this:
 *
 *     new MarkdownParser(schema, md, {
 *       ...defaultMarkdownParser.tokens,
 *       [FROZEN_TOKEN]: frozenTokenSpec(),
 *     });
 *
 * The factory accepts an optional id-generator override so consumers can
 * make ids deterministic in their tests.
 */
export function frozenTokenSpec(options: { generateId?: () => string } = {}): {
  block: 'frozen';
  getAttrs: () => FrozenAttrs;
} {
  const gen = options.generateId ?? defaultGenerateId;
  return {
    block: 'frozen',
    getAttrs: (): FrozenAttrs => ({ id: gen() }),
  };
}

/**
 * Node-serializer entry for `prosemirror-markdown`'s serializer. Mount it
 * under the key 'frozen' on your nodes map.
 *
 * If the frozen contains no embedded `~~`, the inline content is rendered
 * with marks (so emphasis/strong inside frozen survives the round-trip).
 * Otherwise we fall back to writing plain `textContent` with embedded
 * `~~` replaced by the unicode tilde-operator (`∼∼`) so the wrapper still
 * parses unambiguously — marks are dropped in that fallback path.
 */
export function frozenNodeSerializer(state: MarkdownSerializerState, node: PMNode): void {
  if (node.textContent.includes('~~')) {
    const safe = node.textContent.replaceAll('~~', '∼∼');
    state.write(`~~${safe}~~`);
    return;
  }
  state.write('~~');
  state.renderInline(node);
  state.write('~~');
}

/**
 * Convenience: returns a configured MarkdownIt instance with the freeze
 * rule already applied. The caller can pass `options` to customise.
 */
export async function createFreezeMarkdownIt(
  options?: Record<string, unknown>,
): Promise<MarkdownIt> {
  const mod = (await import('markdown-it')) as unknown as {
    default: new (opts?: Record<string, unknown>) => MarkdownIt;
  };
  const md = new mod.default(options ?? {});
  markdownItFreezePlugin(md);
  return md;
}
