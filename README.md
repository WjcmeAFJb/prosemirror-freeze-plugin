# prosemirror-freeze-plugin

A ProseMirror plugin that introduces "frozen" inline sections — text the
end-user cannot delete, edit, cut, or otherwise alter — together with a
markdown serialization (`~~frozen text~~`) and an API for managing the
frozen ranges.

## Why

Some editors need protected snippets — placeholder values, generated
identifiers, content that came from another system — embedded in
otherwise-editable prose. Marks aren't a great fit because adjacent marks
of the same type collapse into one and the cursor cannot land between
them; a deletable atom node isn't a great fit either, and an indelible
atom is opaque to the editor's normal text APIs. This plugin uses an
inline (non-atom) node with a stable id so adjacent frozen ranges remain
two distinct nodes (with a "slit" between them), the text lives as real
text children so marks and editing work normally when allowed, and a
`filterTransaction` hook running on every transaction — including those
dispatched by other plugins — enforces the protection rules.

## Features

- **Inline frozen node with locked rendering.** Text inside a frozen
  section cannot be edited while freeze mode is on (a
  `contenteditable="false"` decoration is applied), and the node cannot
  be deleted by typing, Backspace, Delete, cut, drag, or any other
  transaction unless the call site explicitly opts in via the
  `allowFrozenChanges` meta flag.
- **Editable in non-freeze mode.** Toggling freeze mode off makes frozen
  text behave like any other inline content — the user can place the
  cursor inside, type, apply marks, etc.
- **Adjacent frozen sections do not merge.** Two frozen nodes side-by-side
  remain distinct because each carries a unique id; the cursor can be
  placed in the slit between them and editable text inserted there.
- **Boundary markers.** When the document starts or ends with a frozen
  section, insertion at that boundary is locked. Insert an empty frozen
  marker (`~~~~` in markdown form) to open up the boundary for typing.
- **Markdown round-trip.** Inline rule and serializer entries for
  [markdown-it] and [prosemirror-markdown].
- **Defends against third-party plugins.** Because the rule runs in
  `filterTransaction`, any transaction that would delete or mutate frozen
  content is rejected — regardless of which plugin dispatched it.
- **Freezing mode toggle.** A single command switches the editor between
  "protected" and "free editing" modes for admin/template flows.

## Install

```bash
# From a release tarball:
pnpm add https://github.com/<owner>/prosemirror-freeze-plugin/releases/download/v0.1.0/prosemirror-freeze-plugin-0.1.0.tgz
```

Peer dependencies: `prosemirror-state`, `prosemirror-model`,
`prosemirror-view`, `prosemirror-keymap`, `prosemirror-commands`. Markdown
support optionally peers on `markdown-it` and `prosemirror-markdown`.

## Quick start

```ts
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';

import {
  freezeKeymap,
  freezePlugin,
  freezeSelection,
  frozenNodeSpec,
  insertStartMarker,
  toggleFreezeMode,
} from 'prosemirror-freeze-plugin';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    frozen: frozenNodeSpec,
  },
});

const view = new EditorView(document.querySelector('#editor')!, {
  state: EditorState.create({
    doc: schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('Hello '),
        schema.nodes.frozen.create({ id: 'wid' }, [schema.text('WORLD')]),
        schema.text('!'),
      ]),
    ]),
    plugins: [freezeKeymap(), keymap(baseKeymap), freezePlugin({ freezeMode: true })],
  }),
});
```

## API

### Plugin

```ts
freezePlugin(options?: {
  freezeMode?: boolean;       // default true
  blockCutOnFrozen?: boolean; // default true
}): Plugin;
```

The plugin owns a tiny piece of editor state — currently just `freezeMode` —
and runs `filterTransaction` to reject any transaction that:

1. removes a frozen node that exists in the previous document, or
2. mutates the textContent of an existing frozen node (typed-in changes,
   replacements, etc.), or
3. inserts non-frozen content before/after a non-marker frozen node at
   the document boundary.

A transaction can opt out of all three checks by setting the
`allowFrozenChanges` meta flag — this is what every API command below
does internally.

### Schema

- `frozenNodeSpec` — the `NodeSpec` for the inline (non-atom) frozen node.
  Register it on your schema as `frozen`. The node carries a single
  `id: string` attribute and stores its display text as ordinary text
  children, which means inline marks like bold/italic apply normally and
  the text can be edited directly when freeze mode is off.
- `addFrozenToNodes(nodes)` — convenience that returns a new node-spec map
  with `frozen` appended.
- `isFrozenNode(node)` / `isFrozenMarker(node)` — predicates.

The plugin also installs a `Decoration.node` with
`contenteditable="false"` on every frozen while freeze mode is on, so the
browser refuses keystrokes inside locked content. Turning freeze mode off
(via `toggleFreezeMode` / `setFreezeMode(false)`) drops the decoration
and the user can edit frozen text in place.

### Commands

All commands are standard `(state, dispatch?) => boolean` ProseMirror
commands. They set the `allowFrozenChanges` meta flag on the transactions
they dispatch.

| Command                                     | Purpose                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `toggleFreezeMode`                          | Flip the freeze-mode flag.                                                 |
| `setFreezeMode(value: boolean)`             | Set the freeze-mode flag explicitly.                                       |
| `addFrozen(text)`                           | Insert a new frozen node carrying `text` at the cursor.                    |
| `freezeSelection()`                         | Wrap the current selection's content (with its marks) in one frozen node.  |
| `clearFrozen`                               | Remove the frozen adjacent to the cursor, surrounding it, or in selection. |
| `insertStartMarker()` / `insertEndMarker()` | Pin a boundary marker at the document start/end.                           |
| `removeStartMarker` / `removeEndMarker`     | Symmetric.                                                                 |
| `selectionTouchesFrozen(state)`             | Predicate (not a command) for toolbar enabled-state UIs.                   |
| `canFreezeSelection(state)`                 | Predicate.                                                                 |
| `getFrozenTextById(state)`                  | Map of every frozen `id` → `textContent` in the doc.                       |

### Keymap (`freezeKeymap`)

`freezeKeymap()` returns a ProseMirror plugin with the following defaults:

- `Mod-b` — toggle freeze on the current selection (freeze if not adjacent
  to a frozen, clear if adjacent). Note this displaces the conventional
  bold shortcut; bind bold to `Mod-Shift-b` (or another key) and wire it
  via `prosemirror-commands`'s `toggleMark`.
- `Mod-Shift-b` — clear frozen adjacent to the cursor.
- `Mod-Shift-l` — toggle freeze mode for the whole editor.

Pass `{ freezeKey: false }` etc. to disable individual bindings, or
`{ extra: { ... } }` to merge extra keymap entries.

### Markdown (`prosemirror-freeze-plugin/markdown`)

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

const md = new MarkdownIt('commonmark');
markdownItFreezePlugin(md);

const parser = new MarkdownParser(schema, md, {
  ...defaultMarkdownParser.tokens,
  [FROZEN_TOKEN]: frozenTokenSpec(),
});

const serializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, frozen: frozenNodeSerializer },
  defaultMarkdownSerializer.marks,
);

parser.parse('Hello ~~WORLD~~!'); // → doc with one frozen("WORLD")
parser.parse('~~~~~~start~~ middle ~~end~~~~~~'); // marker, frozen, text, frozen, marker
serializer.serialize(doc); // → markdown back out
```

`~~` conflicts with GFM strikethrough — pick one syntax for any given
markdown-it instance. `markdownItFreezePlugin` registers itself before
`strikethrough` so it wins if both are loaded, but the strikethrough rule
will then never fire.

## Behaviour matrix

| User action                                        | freezeMode on (default) | freezeMode off |
| -------------------------------------------------- | ----------------------- | -------------- |
| Backspace at right edge of a frozen                | blocked                 | deletes        |
| Delete at left edge of a frozen                    | blocked                 | deletes        |
| Selection over frozen + Backspace/Delete/typing    | blocked entirely        | deletes range  |
| Cut with frozen in selection                       | event cancelled         | normal cut     |
| Type at start of doc when first child is frozen    | blocked                 | normal         |
| Type at start when first child is a marker         | allowed                 | allowed        |
| Type in slit between two frozen siblings           | allowed                 | allowed        |
| Type inside frozen text (between glyphs)           | blocked                 | edits the text |
| Drag a frozen out of the document                  | blocked                 | normal         |
| Third-party plugin transaction that removes frozen | blocked                 | normal         |

## Markdown caveats

- `~~` conflicts with GFM strikethrough. Pick one syntax for any given
  markdown-it instance — `markdownItFreezePlugin` registers itself before
  `strikethrough` so it wins if both are loaded, but the strikethrough
  rule will then never fire.
- Marks inside a frozen are preserved through round-trip
  (e.g. `~~**bold**~~` parses back to `frozen([strong("bold")])`).
- If the frozen's text content itself contains `~~`, the serializer falls
  back to writing `~~` replaced by the unicode tilde-operator `∼` so the
  wrapper still parses unambiguously — marks inside frozen are dropped on
  that fallback path.

## Development

```bash
pnpm install
pnpm lint            # oxlint
pnpm typecheck       # tsgo --noEmit
pnpm test            # unit tests
pnpm test:e2e        # browser tests via @vitest/browser + playwright
pnpm build           # tsgo build to dist/
pnpm example:dev     # run the example app
```

Releases are tag-driven: pushing a `v*.*.*` tag triggers a workflow that
runs the verification pipeline, builds, packs a tarball with `pnpm pack`,
and attaches it to a GitHub release ready for `pnpm add <tarball-url>`.

## Licence

MIT.

[markdown-it]: https://github.com/markdown-it/markdown-it
[prosemirror-markdown]: https://github.com/ProseMirror/prosemirror-markdown
