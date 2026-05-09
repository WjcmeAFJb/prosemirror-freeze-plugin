import MarkdownIt from 'markdown-it';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
  MarkdownSerializer,
} from 'prosemirror-markdown';
import { Schema } from 'prosemirror-model';
import { EditorState, type Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import 'prosemirror-view/style/prosemirror.css';

import {
  addFrozen,
  clearFrozen,
  freezeKeymap,
  freezePlugin,
  freezeSelection,
  frozenNodeSpec,
  insertEndMarker,
  insertStartMarker,
  isFreezeModeOn,
  setFreezeMode,
} from '../src/index.js';
import {
  FROZEN_TOKEN,
  frozenNodeSerializer,
  frozenTokenSpec,
  markdownItFreezePlugin,
} from '../src/markdown.js';

// Reuse the default markdown schema (paragraphs, headings, lists, code,
// blockquote, em, strong, ...) and add our frozen node on top.
const schema = new Schema({
  nodes: defaultMarkdownParser.schema.spec.nodes.addToEnd('frozen', frozenNodeSpec),
  marks: defaultMarkdownParser.schema.spec.marks,
});

const md = new MarkdownIt('commonmark', { html: false });
markdownItFreezePlugin(md);

const parser = new MarkdownParser(schema, md, {
  ...defaultMarkdownParser.tokens,
  [FROZEN_TOKEN]: frozenTokenSpec(),
} as ConstructorParameters<typeof MarkdownParser>[2]);

const serializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, frozen: frozenNodeSerializer },
  defaultMarkdownSerializer.marks,
);

const SAMPLE_MARKDOWN = [
  '~~~~Editable headers welcome here.',
  '',
  'Welcome! This sentence is fully editable. Try to delete the next word: ~~PROTECTED~~ — it cannot be removed, edited, or even cut from the document.',
  '',
  'Two adjacent frozen sections still leave a *slit* between them where you can type — go ahead and type in the gap: ~~LEFT~~~~RIGHT~~.',
  '',
  '~~The end of the document is also pinned~~',
].join('\n');

const emType = schema.marks['em'];
const strongType = schema.marks['strong'];

const plugins: Plugin[] = [
  // The freeze keymap rebinds Mod-b to freeze. We bind bold/italic to
  // *Mod-Shift* variants so the user still has shortcuts for them.
  keymap({
    'Mod-Shift-b': strongType ? toggleMark(strongType) : () => false,
    'Mod-i': emType ? toggleMark(emType) : () => false,
  }),
  freezeKeymap(),
  keymap(baseKeymap),
  freezePlugin({ freezeMode: true }),
];

const initialDoc = parser.parse(SAMPLE_MARKDOWN);
const editorContainer = document.querySelector('#editor');
if (!editorContainer) {
  throw new Error('missing #editor mount point');
}

const view = new EditorView(editorContainer as HTMLElement, {
  state: EditorState.create({ doc: initialDoc, plugins }),
  dispatchTransaction(tr) {
    const newState = view.state.apply(tr);
    view.updateState(newState);
    refreshUi();
  },
});

const markdownOut = document.querySelector<HTMLTextAreaElement>('#markdown-out')!;
const markdownError = document.querySelector<HTMLElement>('#markdown-error')!;
const modeIndicator = document.querySelector('#mode-indicator');

// Bidirectional sync between the doc and the markdown textarea. A simple
// boolean lock prevents one side echoing the other side's update back.
let syncing = false;

function refreshUi(): void {
  if (!syncing) {
    syncing = true;
    markdownOut.value = serializer.serialize(view.state.doc);
    syncing = false;
  }
  if (modeIndicator) {
    modeIndicator.textContent = isFreezeModeOn(view.state)
      ? 'freeze mode is ON — frozen text is locked'
      : 'freeze mode is OFF — frozen text can be edited inline';
  }
}
refreshUi();

let parseTimer: ReturnType<typeof setTimeout> | null = null;
markdownOut.addEventListener('input', () => {
  if (syncing) return;
  if (parseTimer) clearTimeout(parseTimer);
  parseTimer = setTimeout(() => {
    parseTimer = null;
    try {
      const parsed = parser.parse(markdownOut.value);
      const newState = EditorState.create({ doc: parsed, plugins });
      syncing = true;
      view.updateState(newState);
      syncing = false;
      markdownError.hidden = true;
      markdownError.textContent = '';
    } catch (err) {
      markdownError.hidden = false;
      markdownError.textContent =
        'Failed to parse markdown: ' + (err instanceof Error ? err.message : String(err));
    }
  }, 250);
});

function bind(id: string, fn: () => void): void {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  el.addEventListener('click', fn);
}

bind('btn-bold', () => {
  if (strongType) toggleMark(strongType)(view.state, view.dispatch.bind(view));
  view.focus();
});
bind('btn-italic', () => {
  if (emType) toggleMark(emType)(view.state, view.dispatch.bind(view));
  view.focus();
});

bind('btn-freeze-selection', () => {
  freezeSelection()(view.state, view.dispatch.bind(view));
  view.focus();
});

bind('btn-clear-frozen', () => {
  clearFrozen(view.state, view.dispatch.bind(view));
  view.focus();
});

bind('btn-add-frozen', () => {
  const text = window.prompt('Frozen text to insert');
  if (!text) return;
  addFrozen(text)(view.state, view.dispatch.bind(view));
  view.focus();
});

bind('btn-start-marker', () => {
  insertStartMarker()(view.state, view.dispatch.bind(view));
  view.focus();
});

bind('btn-end-marker', () => {
  insertEndMarker()(view.state, view.dispatch.bind(view));
  view.focus();
});

const toggle = document.querySelector<HTMLInputElement>('#freeze-mode-toggle');
toggle?.addEventListener('change', () => {
  setFreezeMode(toggle.checked)(view.state, view.dispatch.bind(view));
  view.focus();
});

console.log('Mounted with sample markdown:\n' + SAMPLE_MARKDOWN);
