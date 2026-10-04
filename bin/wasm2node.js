#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { analyze } = require('../src/imports');
const { generate } = require('../src/generate');

function usage() {
  console.error('Usage: wasm2node <file.wasm> [--out harness.js]');
}

function main(argv) {
  const input = argv[2];
  if (!input) { usage(); process.exit(1); }

  let out = null;
  const outIdx = argv.indexOf('--out');
  if (outIdx !== -1 && argv[outIdx + 1]) out = argv[outIdx + 1];

  let bytes;
  try {
    bytes = fs.readFileSync(input);
  } catch (e) {
    console.error(`error: cannot read ${input}: ${e.message}`);
    process.exit(1);
  }

  let analysis;
  try {
    analysis = analyze(bytes);
  } catch (e) {
    console.error(`error: not a valid wasm module: ${e.message}`);
    process.exit(1);
  }

  const code = generate(analysis);

  const unclassified = analysis.imports.filter((i) => i.category === 'unknown' || i.module !== 'wbg');
  console.error(`[wasm2node] ${analysis.imports.length} import(s), ${analysis.exports.length} export(s)`);
  if (unclassified.length) {
    console.error(`[wasm2node] ${unclassified.length} import(s) stubbed (review before trusting the result):`);
    for (const u of unclassified) {
      console.error(`  - ${u.module}.${u.name}  (${u.category === 'unknown' ? 'unclassified name' : 'non-wbg module'})`);
    }
  }

  if (out) {
    fs.writeFileSync(out, code);
    console.error(`[wasm2node] wrote harness to ${out}`);
  } else {
    process.stdout.write(code);
  }
}

main(process.argv);
