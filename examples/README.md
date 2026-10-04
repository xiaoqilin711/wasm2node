# Examples

## `demo.js` — full flow, zero real material

Runs the complete user flow (build a synthetic wasm → generate a harness → load it) using only raw bytes. No site material, no network, no dependencies.

```bash
node examples/demo.js
```

## Using a real wasm-bindgen module

The end-to-end signer described in [docs/case-study.md](../docs/case-study.md) requires the *real* site wasm, which is a third-party asset and is **not committed** to this repository. With your own wasm in hand, the flow is:

```bash
# 1. generate a harness
node bin/wasm2node.js /path/to/fe_sign.wasm --out harness.js

# 2. serve your site's environment values and call the exports
node -e "
const fs = require('fs');
const { loadWasm } = require('./harness.js');
const bytes = fs.readFileSync('/path/to/fe_sign.wasm');
(async () => {
  const wasm = await loadWasm(bytes, myEnv());
  console.log('exports:', Object.keys(wasm));
})();
"
```

Your `myEnv()` must provide whatever the target wasm reads (favicon `href`, `keywords` `content`, etc.) — the trace-based inventory in the case study shows how to discover exactly which APIs matter.
