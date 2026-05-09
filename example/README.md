# Example

A small Vite app that mounts a ProseMirror editor with the freeze plugin
and round-trips the document through markdown so you can see the
serialized form update as you type.

## Run from this repo

```bash
pnpm install
pnpm example:dev
```

## Use the published tarball in your own project

The release workflow attaches a tarball to each tag. Install it like any
other package — pnpm understands the URL form:

```bash
pnpm add https://github.com/<owner>/prosemirror-freeze-plugin/releases/download/v0.1.0/prosemirror-freeze-plugin-0.1.0.tgz
```

Then in your code:

```ts
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';

import {
  freezePlugin,
  frozenNodeSpec,
  freezeSelection,
  insertStartMarker,
} from 'prosemirror-freeze-plugin';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    frozen: frozenNodeSpec,
  },
});

const view = new EditorView(document.querySelector('#editor'), {
  state: EditorState.create({
    doc: schema.node(
      'doc',
      null,
      schema.node('paragraph', null, [
        schema.text('Hello '),
        schema.nodes.frozen.create({ text: 'PROTECTED', id: 'p1' }),
        schema.text(' world.'),
      ]),
    ),
    plugins: [keymap(baseKeymap), freezePlugin({ freezeMode: true })],
  }),
});

// Wire toolbar buttons to commands as needed:
freezeSelection()(view.state, view.dispatch.bind(view));
insertStartMarker()(view.state, view.dispatch.bind(view));
```

For markdown round-trip:

```ts
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
  MarkdownSerializer,
} from 'prosemirror-markdown';
import MarkdownIt from 'markdown-it';

import {
  FROZEN_TOKEN,
  frozenNodeSerializer,
  frozenTokenSpec,
  markdownItFreezePlugin,
} from 'prosemirror-freeze-plugin/markdown';

const md = new MarkdownIt();
markdownItFreezePlugin(md);

const parser = new MarkdownParser(schema, md, {
  ...defaultMarkdownParser.tokens,
  [FROZEN_TOKEN]: frozenTokenSpec(),
});

const serializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, frozen: frozenNodeSerializer },
  defaultMarkdownSerializer.marks,
);
```
