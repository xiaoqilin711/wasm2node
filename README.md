# wasm2node

Generate a Node.js environment-patching harness from a **wasm-bindgen** WebAssembly module — without reading a line of the original algorithm.

Many web apps ship their request-signing logic as a **Rust → WebAssembly** module (`wasm-bindgen` glue). The signature is inside a compiled binary; the JS around it is just generated glue. Reversing a 900 KB `.wat` dump by hand is a losing game. The cheaper path is to **patch the environment, not the algorithm**: mock the handful of browser APIs the wasm reads, then run the wasm as a black box.

`wasm2node` automates exactly that. It reads the module's imports, classifies every `__wbg_*` / `__wbindgen_*` binding by name pattern, and emits a working Node harness — object heap, string bridge, browser-environment mocks, and per-import implementations.

## Why this approach

- **The algorithm is a black box; the environment is small.** A signing wasm typically touches only `document`, `navigator`, `crypto` and a few globals. Mock those, and the wasm runs.
- **wasm-bindgen imports are highly regular.** `__wbg_get_<hash>`, `__wbg_static_accessor_<NAME>_<hash>`, `__wbg_getRandomValues_<hash>`, … the `<hash>` is a build fingerprint; the stable prefix tells you what the binding does. Hand-writing 42 of them is mechanical — which is precisely why a generator does it better.
- **Zero dependencies.** Import extraction uses the native `WebAssembly.Module` API; no wasm parser, no `wabt`, no Rust toolchain.

## Features

- Extract and classify all imports/exports via native `WebAssembly.Module`.
- Emit a standalone, require-able harness (`loadWasm`, `buildImports`, `defaultEnv`).
- Classify the full wasm-bindgen import family (strings, object heap, `Reflect.get/set`, globals, TypedArray, crypto, DOM, Node-detection).
- Stub unclassified or non-`wbg` imports with a safe default and report them loudly.

## Quick start

```bash
# 1. generate a harness from a wasm-bindgen module
node bin/wasm2node.js path/to/fe_sign.wasm --out harness.js

# 2. load it from your own script
node -e "
const fs = require('fs');
const { loadWasm } = require('./harness.js');
(async () => {
  const wasm = await loadWasm(fs.readFileSync('path/to/fe_sign.wasm'));
  console.log('exports:', Object.keys(wasm));
})();
"
```

The exported function names come from *your* wasm (e.g. `signtool_new`, `signtool_sign`), not from this tool.

### Serving site-specific environment values

The default environment is deliberately empty (`document.querySelector` returns `null`, `navigator.webdriver` is read-only `false`). For a real target you override it:

```js
const { loadWasm } = require('./harness.js');

function env() {
  const el = (attrs) => ({ getAttribute: (n) => attrs[n] ?? null, ...attrs });
  return {
    document: {
      querySelector(sel) {
        if (sel === "link[rel*='icon']") return el({ href: 'https://assets.example.com/favicon.ico' });
        return null;
      },
    },
    navigator: Object.defineProperty(Object.create(null), 'webdriver',
      { value: false, writable: false, configurable: false, enumerable: true }),
    crypto: globalThis.crypto,
  };
}

const wasm = await loadWasm(bytes, env());
```

## Architecture

```
fe_sign.wasm
    │  WebAssembly.Module.imports()
    ▼
src/imports.js   ── extract + classify each import (src/classify.js)
    │
    ▼
src/generate.js  ── map category → implementation, splice into a harness template
    │
    ▼
harness.js  (heap + string bridge + env mocks + per-import impls)
    │  WebAssembly.instantiate(bytes, buildImports(env))
    ▼
black-box wasm, callable from Node
```

## Tests

```bash
npm test
```

Tests build a minimal valid wasm module from raw bytes (no real site material) and verify three layers: import classification, extraction, and that the generated harness satisfies every import so `instantiate()` succeeds. See `test/`.

## Honest boundaries

- This is an **environment-patching** tool, not an **algorithm-recovery** tool. It makes the wasm run as a black box; it does not reconstruct the underlying crypto in pure JS/Python.
- End-to-end signature reproduction depends on the real site wasm, which is **not provided** in this repo (it is a third-party asset). The unit tests cover the tool's own three layers only.
- An unclassified import is stubbed with `() => 0`. If the wasm actually calls it at runtime you must implement it by hand — the CLI prints every stubbed import.

## See also

- [docs/case-study.md](docs/case-study.md) — full write-up: from a 403 endpoint to a working black-box signer, and why this tool exists.
- `wasm-algo-fingerprint` — the sibling project that answers the other half of the same investigation: *what algorithm is actually inside the wasm?*

## License

MIT
