'use strict';

// End-to-end demo using a synthetic wasm-bindgen-style module assembled from
// raw bytes (no real site material). It walks the whole user flow:
//   analyze -> generate -> loadWasm -> inspect exports

const { buildWasm, I32 } = require('../test/fixtures');
const { analyze } = require('../src/imports');
const { generate } = require('../src/generate');

function evalHarness(code) {
  const sandbox = { module: { exports: {} }, exports: {} };
  new Function('module', 'exports', code)(sandbox.module, sandbox.exports);
  return sandbox.module.exports;
}

async function main() {
  // 1. a synthetic module with a handful of wasm-bindgen imports
  const bytes = buildWasm([
    { module: 'wbg', name: '__wbindgen_string_new', params: [I32, I32], results: [I32] },
    { module: 'wbg', name: '__wbg_get_67b2ba62fc30de12', params: [I32, I32], results: [I32] },
    { module: 'wbg', name: '__wbg_static_accessor_PROCESS_2c90d3b3264f2c90', params: [], results: [I32] },
    { module: 'wbg', name: '__wbg_getRandomValues_bcb4912f16000dc4', params: [I32, I32], results: [] },
  ]);

  // 2. analyze + generate (equivalent to: wasm2node module.wasm --out harness.js)
  const analysis = analyze(bytes);
  const code = generate(analysis);
  console.log(`analyzed: ${analysis.imports.length} imports, ${analysis.exports.length} exports`);

  // 3. load the module through the generated harness
  const { loadWasm } = evalHarness(code);
  const wasm = await loadWasm(bytes);
  console.log('exports:', Object.keys(wasm));
  console.log('OK — every import was satisfied, the module instantiated.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
