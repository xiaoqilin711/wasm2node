'use strict';

// Classify a wasm-bindgen import name into a category.
// The category drives which harness snippet the generator emits.
//
// wasm-bindgen import names come in two families:
//   * `__wbindgen_*`            — fixed names, no hash suffix (the glue ABI)
//   * `__wbg_<name>_<hash>`     — generated names, 32-bit build hash suffix
// The `<hash>` is a build fingerprint, so we match on the stable prefix and
// drop the hash. This is what makes the classifier reusable across builds.

const WBG_EXACT = {
  __wbindgen_string_new: 'string-new',
  __wbindgen_string_get: 'string-get',
  __wbindgen_object_clone_ref: 'object-clone-ref',
  __wbindgen_object_drop_ref: 'object-drop-ref',
  __wbindgen_is_undefined: 'is-undefined',
  __wbindgen_is_object: 'is-object',
  __wbindgen_is_string: 'is-string',
  __wbindgen_is_function: 'is-function',
  __wbindgen_boolean_get: 'boolean-get',
  __wbindgen_number_new: 'number-new',
  __wbindgen_debug_string: 'debug-string',
  __wbindgen_throw: 'throw',
  __wbindgen_memory: 'memory',
};

// strip the trailing "_<hash>" from a `__wbg_*` name.
function stripHash(name) {
  const idx = name.lastIndexOf('_');
  if (idx === -1) return name;
  const tail = name.slice(idx + 1);
  // the build hash is 8-16 lowercase hex chars; only strip when it looks like one
  if (/^[0-9a-f]{8,16}$/.test(tail)) return name.slice(0, idx);
  return name;
}

function classify(name) {
  if (WBG_EXACT[name]) return { category: WBG_EXACT[name], name };

  if (name.startsWith('__wbg_static_accessor_')) {
    // e.g. __wbg_static_accessor_PROCESS_2c90d3b3264f2c90
    const rest = name.slice('__wbg_static_accessor_'.length);
    const target = stripHash(rest);
    if (target === 'PROCESS') return { category: 'hide-node', name, target };
    return { category: 'global-accessor', name, target };
  }

  // order matters: `__wbg_get_` must be checked before `__wbg_getRandomValues_`
  if (name.startsWith('__wbg_get_')) return { category: 'reflect-get', name };
  if (name.startsWith('__wbg_set_')) return { category: 'reflect-set', name };
  if (name.startsWith('__wbg_call_')) return { category: 'call', name };
  if (name.startsWith('__wbg_newnoargs_')) return { category: 'newnoargs', name };

  if (name.startsWith('__wbg_newwithlength_')) return { category: 'typedarray-new-length', name };
  if (name.startsWith('__wbg_newwithbyteoffsetandlength_')) return { category: 'typedarray-new-offset-length', name };
  if (name.startsWith('__wbg_new_')) return { category: 'typedarray-new', name };
  if (name.startsWith('__wbg_buffer_')) return { category: 'typedarray-buffer', name };
  if (name.startsWith('__wbg_subarray_')) return { category: 'typedarray-subarray', name };

  if (name.startsWith('__wbg_getRandomValues_')) return { category: 'get-random-values', name };
  if (name.startsWith('__wbg_randomFillSync_')) return { category: 'random-fill-sync', name };
  if (name.startsWith('__wbg_crypto_')) return { category: 'crypto', name };
  if (name.startsWith('__wbg_msCrypto_')) return { category: 'mscrypto', name };

  if (name.startsWith('__wbg_process_')) return { category: 'hide-node', name };
  if (name.startsWith('__wbg_versions_')) return { category: 'hide-node', name };
  if (name.startsWith('__wbg_node_')) return { category: 'hide-node', name };
  if (name.startsWith('__wbg_require_')) return { category: 'hide-node', name };

  if (name.startsWith('__wbg_document_')) return { category: 'document', name };
  if (name.startsWith('__wbg_navigator_')) return { category: 'navigator', name };
  if (name.startsWith('__wbg_querySelector_')) return { category: 'query-selector', name };
  if (name.startsWith('__wbg_getAttribute_')) return { category: 'get-attribute', name };
  if (name.startsWith('__wbg_instanceof_Window_')) return { category: 'instanceof-window', name };

  return { category: 'unknown', name };
}

module.exports = { classify, WBG_EXACT };
