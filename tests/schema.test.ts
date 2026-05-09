import { beforeEach, describe, expect, it } from 'vitest';

import {
  addFrozenToNodes,
  FROZEN_NODE_NAME,
  frozenNodeSpec,
  hasFrozenNode,
  isFrozenMarker,
  isFrozenNode,
} from '../src/index.js';
import { doc, frozen, marker, p, resetIds, schema } from './helpers.js';

describe('schema', () => {
  beforeEach(resetIds);

  it('exposes the canonical name', () => {
    expect(FROZEN_NODE_NAME).toBe('frozen');
  });

  it('registers the frozen node on the schema', () => {
    expect(hasFrozenNode(schema)).toBe(true);
    expect(schema.nodes['frozen']).toBeDefined();
  });

  it('detects frozen nodes via isFrozenNode', () => {
    const node = frozen('hello');
    expect(isFrozenNode(node)).toBe(true);
    const text = schema.text('hello');
    expect(isFrozenNode(text)).toBe(false);
  });

  it('detects markers via isFrozenMarker', () => {
    expect(isFrozenMarker(marker())).toBe(true);
    expect(isFrozenMarker(frozen('hello'))).toBe(false);
    expect(isFrozenMarker(null)).toBe(false);
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(isFrozenMarker(undefined)).toBe(false);
  });

  it('frozen nodes are inline non-atoms with text content', () => {
    const node = frozen('hello');
    expect(node.isInline).toBe(true);
    expect(node.isAtom).toBe(false);
    expect(node.textContent).toBe('hello');
  });

  it('frozen nodes carry an id attr', () => {
    const node = frozen('hello world', 'my-id');
    expect(node.attrs['id']).toBe('my-id');
    expect(node.textContent).toBe('hello world');
  });

  it('two adjacent frozen nodes do not merge in the doc', () => {
    const document_ = doc(p(frozen('a', 'a-id'), frozen('b', 'b-id')));
    expect(document_.firstChild!.childCount).toBe(2);
    expect(document_.firstChild!.child(0).textContent).toBe('a');
    expect(document_.firstChild!.child(1).textContent).toBe('b');
  });

  it('addFrozenToNodes merges the spec into a node map', () => {
    const result = addFrozenToNodes({
      doc: { content: 'block+' },
      paragraph: { content: 'inline*', group: 'block' },
      text: { group: 'inline' },
    });
    expect(result['frozen']).toBe(frozenNodeSpec);
  });

  it('addFrozenToNodes throws if frozen is already present', () => {
    expect(() =>
      addFrozenToNodes({
        doc: { content: 'block+' },
        text: { group: 'inline' },
        frozen: frozenNodeSpec,
      }),
    ).toThrow(/frozen/);
  });

  it('marker has empty content', () => {
    expect(marker().content.size).toBe(0);
    expect(marker().textContent).toBe('');
  });
});
