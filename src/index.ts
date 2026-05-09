export {
  FROZEN_NODE_NAME,
  type Command,
  type FreezePluginOptions,
  type FreezePluginState,
  type FreezeTransactionMeta,
  type FrozenAttrs,
  type FrozenNodeMatch,
  type FrozenNodeName,
} from './types.js';

export {
  addFrozenToNodes,
  frozenNodeSpec,
  hasFrozenNode,
  isFrozenMarker,
  isFrozenNode,
} from './schema.js';

export {
  findFrozenInRange,
  freezePlugin,
  freezePluginKey,
  getFreezePluginState,
  isFreezeModeOn,
  readFreezeMeta,
  selectionContainsFrozen,
  setFreezeMeta,
} from './plugin.js';

export {
  addFrozen,
  buildFrozenFragment,
  canFreezeSelection,
  clearFrozen,
  freezeSelection,
  getFrozenTextById,
  insertEndMarker,
  insertStartMarker,
  removeEndMarker,
  removeStartMarker,
  selectionTouchesFrozen,
  setFreezeMode,
  toggleFreezeMode,
} from './commands.js';

export { freezeKeymap } from './keymap.js';

export { defaultGenerateId } from './id.js';
