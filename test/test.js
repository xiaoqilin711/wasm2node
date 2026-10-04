'use strict';

const assert = require('assert');
const { buildWasm, I32, I64 } = require('./fixtures');
const { analyze } = require('../src/imports');
const { classify } = require('../src/classify');
const { generate } = require('../src/generate');

function evalHarness(code) {
  const sandbox = { module: { exports: {} }, exports: {} };
  new Function('module', 'exports', code)(sandbox.module, sandbox.exports);
  return sandbox.module.exports;
}

const tests = [];

tests.push(function classify_rules() {
  assert.strictEqual(classify('__wbindgen_string_new').category, 'string-new');
  assert.strictEqual(classify('__wbindgen_memory').category, 'memory');
  assert.strictEqual(classify('__wbg_get_67b2ba62fc30de12').category, 'reflect-get');
  assert.strictEqual(classify('__wbg_set_bb8cecf6a62b9f46').category, 'reflect-set');
  assert.strictEqual(classify('__wbg_getRandomValues_bcb4912f16000dc4').category, 'get-random-values');
  assert.strictEqual(classify('__wbg_static_accessor_PROCESS_2c90d3b3264f2c90').category, 'hide-node');
  assert.strictEqual(classify('__wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0').category, 'global-accessor');
  assert.strictEqual(classify('__wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0').target, 'GLOBAL_THIS');
  assert.strictEqual(classify('__wbg_process_5c1d670bc53614b8').category, 'hide-node');
  assert.strictEqual(classify('__wbg_querySelector_c69f8b573958906b').category, 'query-selector');
  assert.strictEqual(classify('__wbg_require_79b1e9274cde3c87').category, 'hide-node');
  assert.strictEqual(classify('totally_random_name_1234').category, 'unknown');
  // getRandomValues must NOT be misclassified as reflect-get
  assert.notStrictEqual(classify('__wbg_getRandomValues_bcb4912f16000dc4').category, 'reflect-get');
});

tests.push(function analyze_extracts_and_classifies() {
  const bytes = buildWasm([
    { module: 'wbg', name: '__wbindgen_string_new', params: [I32, I32], results: [I32] },
    { module: 'wbg', name: '__wbg_get_67b2ba62fc30de12', params: [I32, I32], results: [I32] },
    { module: 'wbg', name: '__wbg_static_accessor_PROCESS_2c90d3b3264f2c90', params: [], results: [I32] },
    { module: 'wbg', name: '__wbg_getRandomValues_bcb4912f16000dc4', params: [I32, I32], results: [] },
    { module: 'env', name: 'some_unknown_import', params: [I32], results: [I32] },
  ]);
  const analysis = analyze(bytes);
  assert.strictEqual(analysis.imports.length, 5);

  const byName = Object.fromEntries(analysis.imports.map((i) => [i.name, i]));
  assert.strictEqual(byName['__wbindgen_string_new'].category, 'string-new');
  assert.strictEqual(byName['__wbindgen_string_new'].module, 'wbg');
  assert.strictEqual(byName['__wbg_get_67b2ba62fc30de12'].category, 'reflect-get');
  assert.strictEqual(byName['__wbg_static_accessor_PROCESS_2c90d3b3264f2c90'].category, 'hide-node');
  assert.strictEqual(byName['__wbg_getRandomValues_bcb4912f16000dc4'].category, 'get-random-values');
  assert.strictEqual(byName['some_unknown_import'].module, 'env');
});

tests.push(async function generated_harness_instantiates_fixture() {
  const bytes = buildWasm([
    { module: 'wbg', name: '__wbindgen_string_new', params: [I32, I32], results: [I32] },
    { module: 'wbg', name: '__wbindgen_string_get', params: [I32, I32], results: [] },
    { module: 'wbg', name: '__wbindgen_memory', params: [], results: [I32] },
    { module: 'wbg', name: '__wbg_get_67b2ba62fc30de12', params: [I32, I32], results: [I32] },
    { module: 'wbg', name: '__wbg_set_bb8cecf6a62b9f46', params: [I32, I32, I32], results: [I32] },
    { module: 'wbg', name: '__wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0', params: [], results: [I32] },
    { module: 'wbg', name: '__wbg_static_accessor_PROCESS_2c90d3b3264f2c90', params: [], results: [I32] },
    { module: 'wbg', name: '__wbg_getRandomValues_bcb4912f16000dc4', params: [I32, I32], results: [] },
    { module: 'wbg', name: '__wbg_document_d249400bd7bd996d', params: [I32], results: [I32] },
    { module: 'wbg', name: '__wbg_querySelector_c69f8b573958906b', params: [I32, I32, I32], results: [I32] },
    { module: 'wbg', name: '__wbg_newwithlength_a381634e90c276d4', params: [I32], results: [I32] },
    { module: 'wbg', name: '__wbg_unrecognized_abc12345', params: [I32], results: [I32] },
    { module: 'env', name: 'some_unknown_import', params: [I32], results: [I32] },
  ]);
  const analysis = analyze(bytes);
  const code = generate(analysis);

  // The generated code must satisfy every import so instantiate() does not
  // throw a LinkError. This is the hard check that the generator covered all
  // of the fixture's imports (wbg, non-wbg, and unclassified).
  const { loadWasm } = evalHarness(code);
  const wasmExports = await loadWasm(bytes);
  assert.ok(wasmExports, 'loadWasm should return the wasm exports object');
  assert.strictEqual(typeof wasmExports.__wbg_get_67b2ba62fc30de12, 'function');
});

(async function run() {
  let passed = 0;
  for (const t of tests) {
    await t();
    passed++;
    console.log(`ok - ${t.name}`);
  }
  console.log(`\n${passed}/${tests.length} tests passed`);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
