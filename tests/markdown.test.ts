import MarkdownIt from 'markdown-it';
import { Schema } from 'prosemirror-model';
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
  MarkdownSerializer,
} from 'prosemirror-markdown';
import { beforeEach, describe, expect, it } from 'vitest';

import { frozenNodeSpec } from '../src/index.js';
import {
  FROZEN_TOKEN,
  frozenNodeSerializer,
  frozenTokenSpec,
  markdownItFreezePlugin,
} from '../src/markdown.js';
import { resetIds } from './helpers.js';

const schema = new Schema({
  nodes: defaultMarkdownParser.schema.spec.nodes.addToEnd('frozen', frozenNodeSpec),
  marks: defaultMarkdownParser.schema.spec.marks,
});

let counter = 0;
const deterministicGen = (): string => {
  counter += 1;
  return `tok-${counter}`;
};

const markdownIt = new MarkdownIt('commonmark', {});
markdownItFreezePlugin(markdownIt);

const parser = new MarkdownParser(schema, markdownIt, {
  ...defaultMarkdownParser.tokens,
  [FROZEN_TOKEN]: frozenTokenSpec({ generateId: deterministicGen }),
} as ConstructorParameters<typeof MarkdownParser>[2]);

const serializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, frozen: frozenNodeSerializer },
  defaultMarkdownSerializer.marks,
);

describe('markdown: tokenizer rule', () => {
  beforeEach(() => {
    counter = 0;
    resetIds();
  });

  it('parses ~~text~~ as a frozen node', () => {
    const result = parser.parse('Some ~~secret~~ here');
    const para = result.firstChild!;
    expect(para.childCount).toBe(3);
    expect(para.child(1).type.name).toBe('frozen');
    expect(para.child(1).textContent).toBe('secret');
  });

  it('parses ~~~~ as an empty marker', () => {
    const result = parser.parse('~~~~Tail');
    const para = result.firstChild!;
    expect(para.firstChild!.type.name).toBe('frozen');
    expect(para.firstChild!.textContent).toBe('');
  });

  it('parses ~~**bold**~~ with marks preserved inside', () => {
    const result = parser.parse('~~**emphatic**~~ trailing');
    const para = result.firstChild!;
    const frz = para.firstChild!;
    expect(frz.type.name).toBe('frozen');
    expect(frz.textContent).toBe('emphatic');
    // The inner text node should carry the strong mark.
    const innerText = frz.firstChild!;
    expect(innerText.text).toBe('emphatic');
    expect(innerText.marks.some((m) => m.type.name === 'strong')).toBe(true);
  });

  it('parses the spec example: marker, frozen, text, frozen, marker', () => {
    const md =
      '~~~~~~freezed text~~ something else not freezed~~another freezed text at the end~~~~~~';
    const result = parser.parse(md);
    const para = result.firstChild!;
    const types: string[] = [];
    const texts: string[] = [];
    para.forEach((child) => {
      types.push(child.type.name);
      texts.push(
        child.type.name === 'frozen' ? `frozen(${child.textContent})` : (child.text ?? ''),
      );
    });
    expect(types[0]).toBe('frozen');
    expect(texts[0]).toBe('frozen()');
    expect(types[1]).toBe('frozen');
    expect(texts[1]).toBe('frozen(freezed text)');
    expect(types[2]).toBe('text');
    expect(texts[2]).toBe(' something else not freezed');
    expect(types[3]).toBe('frozen');
    expect(texts[3]).toBe('frozen(another freezed text at the end)');
    expect(types[4]).toBe('frozen');
    expect(texts[4]).toBe('frozen()');
  });

  it('refuses to span newlines (preserves paragraph break)', () => {
    const md = '~~start\nend~~';
    const result = parser.parse(md);
    let frozenCount = 0;
    result.descendants((node) => {
      if (node.type.name === 'frozen') frozenCount += 1;
      return true;
    });
    expect(frozenCount).toBe(0);
  });
});

describe('markdown: serializer', () => {
  beforeEach(() => {
    counter = 0;
    resetIds();
  });

  it('serializes a frozen node as ~~text~~', () => {
    const document_ = parser.parse('hello ~~secret~~ world');
    const out = serializer.serialize(document_);
    expect(out).toBe('hello ~~secret~~ world');
  });

  it('serializes a marker as ~~~~', () => {
    const document_ = parser.parse('~~~~remaining text');
    const out = serializer.serialize(document_);
    expect(out).toBe('~~~~remaining text');
  });

  it('round-trips marks inside frozen content', () => {
    const document_ = parser.parse('~~**bold**~~');
    const out = serializer.serialize(document_);
    expect(out).toBe('~~**bold**~~');
  });

  it('round-trips the full spec example', () => {
    const md =
      '~~~~~~freezed text~~ something else not freezed~~another freezed text at the end~~~~~~';
    const document_ = parser.parse(md);
    const out = serializer.serialize(document_);
    expect(out).toBe(md);
  });

  it('escapes embedded ~~ in frozen text (marks dropped on this path)', () => {
    const frozenType = schema.nodes['frozen']!;
    const document_ = schema.node('doc', null, [
      schema.node('paragraph', null, [frozenType.create({ id: 'x' }, [schema.text('a~~b')])]),
    ]);
    const out = serializer.serialize(document_);
    expect(out).toBe('~~a∼∼b~~');
  });
});

describe('markdown: idempotent rule registration', () => {
  it('markdownItFreezePlugin is a no-op when called twice', () => {
    const md = new MarkdownIt('commonmark');
    markdownItFreezePlugin(md);
    const before = md.inline.ruler.getRules('').length;
    markdownItFreezePlugin(md);
    expect(md.inline.ruler.getRules('').length).toBe(before);
  });
});
