'use strict';

const { classify } = require('./classify');

// Extract the imports of a wasm module via the native WebAssembly.Module API
// (no third-party wasm parser needed), then classify each import name.
//
// Returns { imports: [{ module, name, kind, category, target }], exports: [{ name, kind }] }
function analyze(wasmBytes) {
  const module = new WebAssembly.Module(wasmBytes);
  const raw = WebAssembly.Module.imports(module);
  const imports = raw.map(({ module, name, kind }) => {
    const info = classify(name);
    return {
      module,
      name,
      kind,
      category: info.category,
      target: info.target || null,
    };
  });
  const exports = WebAssembly.Module.exports(module).map(({ name, kind }) => ({ name, kind }));
  return { imports, exports };
}

module.exports = { analyze };
