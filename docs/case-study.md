# From 403 to a Black-Box Signer: Patching the Browser Environment for a wasm-bindgen Signature

> **Target**: a commission-art marketplace (domain de-identified as `example.com`).
> **Goal**: reproduce the `M-S` request header in Node.js — no browser, no login.
> **Route taken**: runtime trace → locate the signature → chase it into a wasm module → mock the environment → run the wasm as a black box.
> **Outcome**: a working signer, cross-validated, then generalized into the `wasm2node` tool in this repository.

This write-up is the *environment-patching* half of the investigation. The *algorithm-identification* half (what cipher is actually inside the wasm) lives in the sibling project `wasm-algo-fingerprint`.

---

## 1. The problem: a 403 on a plain GET

The target is a public listing page. In a browser it returns JSON; from `curl`, `requests`, or `fetch` it returns 403. A packet capture shows two extra headers on the real request:

```
M-S: <a 100–124 char base64-ish string>
M-T: 1778571128
```

`M-T` is obviously a second-precision timestamp. `M-S` is the signature. The server rejects any request whose `M-S` does not match.

So the goal is one sentence: **reproduce the algorithm that produces `M-S`, in Node.js, with zero browser and zero login state.**

---

## 2. The tool: runtime tracing instead of reading obfuscated JS

The front end is minified and obfuscated; static reading is a needle-in-a-haystack job. The investigation instead used a modified Firefox build (kernel 155.0.1) that logs **every DOM / BOM / WebAPI call** the page makes into structured NDJSON.

The philosophy is the inverse of the usual one: **don't guess what the obfuscated code does — record what it actually calls at runtime.** A signature has to be *sent*, so it has to pass through `setRequestHeader`. It has to *encrypt*, so it has to touch `crypto`. It has to *read its environment*, so it has to touch `document` / `navigator`. Those calls cannot hide.

Each record looks like this:

```json
{
  "type": "call",
  "interface": "XMLHttpRequest",
  "member": "setRequestHeader",
  "args": ["M-S", "3F9aJFJZ..."],
  "stack": [{"func": "sign", "file": "http.BzJ4_4Bj.js", "line": 2, "col": 741}]
}
```

The `type` field is `call` (method call, with `return`), `get` (property read, with `value`), or `set` (property write). The `stack` gives a full call chain for locating anything. One page load produced ~240k lines; greppable, structured, and far more informative than the minified source.

> The trace tool is a third-party closed-source browser build. This repository only describes the *methodology* and what the logs contained; it does not distribute the tool.

---

## 3. Round 1: capture a real sample, locate where the signature is set

The first step is always **a real sample** — without a ground truth, "does my reproduction match?" is unanswerable.

Grepping the 240k-line log for `setRequestHeader` lands on this cluster:

```json
{"type":"call","interface":"XMLHttpRequest","member":"setRequestHeader","args":["Accept","application/json, text/plain, */*"]}
{"type":"call","interface":"XMLHttpRequest","member":"setRequestHeader","args":["Authorization","Bearer null"]}
{"type":"call","interface":"XMLHttpRequest","member":"setRequestHeader","args":["M-S","3F9aJFJZweno_oVRtVCO+RWLM1mUV1GOB9Wb40CZtMGarRjMwYjM5cTO0gTbV9GTvZGO4QHW39WIYFSMSpFZtYlVSd2ZzR0ZSJVTzxDP"]}
{"type":"call","interface":"XMLHttpRequest","member":"setRequestHeader","args":["M-T","1778571128"]}
{"type":"call","interface":"XMLHttpRequest","member":"setRequestHeader","args":["Web-Version","frontend"]}
```

Three facts fall out immediately:

1. `M-T = 1778571128` — a second-precision timestamp.
2. `M-S`, `M-T`, and `Web-Version` are set in the same place, so the generation logic is concentrated in one interceptor.
3. The signature is base64-style, and **this sample is 104 characters** — and the length is *not fixed*. That observation will later become a trap.

---

## 4. Round 2: chase the value back into the wasm

"Where it is set" is not "where it is born". The next question is who *produces* the string.

Searching the log for the signature value's **first appearance** finds a `TextDecoder.decode` call — the signature is decoded out of a block of wasm memory:

```json
{
  "type": "call", "interface": "TextDecoder", "member": "decode",
  "args": [{"0":51,"1":70,"2":57,"3":97,"4":74,"..."}],
  "return": "3F9aJFJZweno_oVRtVCO+...",
  "stack": [
    {"func":"O","file":"http.BzJ4_4Bj.js"},
    {"func":"sign","file":"http.BzJ4_4Bj.js","line":2,"col":741},
    {"func":"sign","file":"http.BzJ4_4Bj.js","line":2,"col":11451}
  ]
}
```

Walking further up the stack reveals the wasm-bindgen signature — `__wbindgen_string_new` — bottoming out in a `.wasm` file:

```json
{
  "type": "call", "interface": "TextDecoder", "member": "decode",
  "args": [{"0":101,"1":120,"2":105,"3":116}],
  "return": "exit",
  "stack": [
    {"func":"O","file":"http.BzJ4_4Bj.js"},
    {"func":"Se/t.wbg.__wbindgen_string_new","file":"http.BzJ4_4Bj.js"},
    {"func":"","file":"fe_sign_bg.DLpTGLRB.wasm","line":54608}
  ]
}
```

Conclusion: the signature is produced inside a **Rust-compiled WebAssembly module** (`fe_sign_bg.DLpTGLRB.wasm`). The JS is just wasm-bindgen glue. The file name `fe_sign` even spells it out: *front-end signature*.

The timestamp is confirmed in the same pass:

```json
{"type":"call","interface":"Date","member":"now","return":1.77857e+12}
{"type":"call","interface":"Math","member":"floor","args":[1.77857e+09],"return":1778571128}
```

`M-T = Math.floor(Date.now() / 1000)`. Done.

---

## 5. Round 3: inventory the environment the wasm depends on

Here the path forks:

- **Path A (hard)**: disassemble the wasm, reverse the algorithm, rewrite it in JS/Python.
- **Path B (black box)**: don't touch the internals — mock the browser environment the wasm reads, and let it run.

Which path wins depends on one question: **how much does the wasm actually consume from its environment?** The trace answers it precisely.

**It uses the favicon URL as signing material.** During wasm initialization, it queries the DOM:

```json
{"type":"call","interface":"TextDecoder","member":"decode","args":[...],"return":"link[rel*='icon']"}
{"type":"call","interface":"Document","member":"querySelector","args":["link[rel*='icon']"],"return":"[Object HTMLLinkElement]"}
{"type":"call","interface":"Element","member":"getAttribute","args":["href"],"return":"https://js-assets.example.com/assets/legacy/favicon.ico"}
```

Why would a signer touch the favicon? Because it is an **environment fingerprint**: present and correct in a real browser, absent in a headless one. Mixing it into the signature welds "are you in a real browser?" into the signature itself.

**It runs an anti-automation check — `navigator.webdriver` must be read-only.**

```json
{"type":"get","interface":"Window","member":"get navigator"}
{"type":"call","interface":"TextDecoder","member":"decode","return":"webdriver"}
{"type":"call","interface":"Reflect","member":"set","args":["[Object Navigator]","webdriver",true],"return":false}
{"type":"get","interface":"Navigator","member":"get webdriver","value":false}
```

That `return: false` is the whole trick. The wasm tries `Reflect.set(navigator, "webdriver", true)`:

- returns `true` (write succeeded) → the navigator is an ordinary writable object, likely a Puppeteer/Selenium-injected fake → **panic**;
- returns `false` (write refused) → `webdriver` is a native read-only getter → a real browser → **pass**.

**It has a random component.**

```json
{"type":"call","interface":"Crypto","member":"getRandomValues",
 "args":[{"0":168,"1":26,"... 32 bytes"}],
 "stack":[{"func":"Se/t.wbg.__wbg_getRandomValues_bcb4912f16000dc4/<","file":"http.BzJ4_4Bj.js"}]}
```

`getRandomValues` is called with 32 bytes, so a nonce/random salt is mixed in. The same URL yields a *different* `M-S` every time — which kills the "it's a deterministic HMAC" guess and explains why the first sample had no fixed length.

The full environment dependency list is short:

| environment API | purpose | how to mock |
|---|---|---|
| `document.querySelector("link[rel*='icon']")` | favicon fingerprint | return a fixed element |
| `element.getAttribute("href")` | favicon URL | return the real fixed value |
| `navigator.webdriver` | anti-automation | non-writable `false` |
| `Reflect.set(navigator, "webdriver", true)` | anti-automation | must return `false` |
| `crypto.getRandomValues()` | nonce | Node's crypto |
| `process` / `node` / `require` | environment detection | hide all, return 0 |

**Path B is clearly viable, and far cheaper than Path A.** (I still spent time on Path A before turning around — that's the tuition of Round 6.)

---

## 6. Round 4: read the glue layer, pin down the exact input

Before mocking anything, one more piece is needed: the *exact input* to the sign function.

The wasm-bindgen glue (`http.BzJ4_4Bj.js`), de-obfuscated, reduces to:

```javascript
class SignTool {
    constructor() { this.__wbg_ptr = _.signtool_new() >>> 0; }
    sign(url, timestamp) {
        _.signtool_sign(stackPtr, this.__wbg_ptr, urlPtr, urlLen, timestamp);
        return getStringFromWasm(outPtr, outLen);
    }
}
```

And the interceptor that feeds it:

```javascript
const G = async (config, sign) => {
    const t = Math.floor(Date.now() / 1e3);   // timestamp
    const u = encodeURI(config.url);          // <-- the input
    config.headers = { ...config.headers, "M-S": sign(u, t), "M-T": t, "Web-Version": "frontend" };
};
```

The trap here is subtle: `config.url` is axios's `config.url` — **path only, no query string** (`params` are appended separately at send time). So the signing input is:

```
/api/v1/stalls/preview                    ← 22 bytes, correct
/api/v1/stalls/preview?topic_count=4      ← with query, signs to a wrong value
```

This detail, plus the environment list from Round 3, is everything needed to build the harness.

---

## 7. Round 5: hand-write the 42 imports

The black-box harness has three layers:

```
① mock the browser environment (document / navigator / crypto)
② implement the wasm-bindgen imports (42 × __wbg_* / __wbindgen_*)
③ a thin wrapper: load wasm → sign(path, ts) → return M-S
```

The wasm-bindgen glue needs an **object heap** to map JS objects to wasm-visible `i32` handles:

```javascript
const heap = [undefined, null, true, false];   // first 4 slots are reserved
function addHeapObject(obj) { heap.push(obj); return heap.length - 1; }
function getObject(idx) { return heap[idx]; }
```

Then the environment mocks:

```javascript
// document: only the favicon selector matters
const fakeDocument = {
  querySelector(sel) {
    if (sel === "link[rel*='icon']") return makeElement({ href: "https://js-assets.example.com/assets/legacy/favicon.ico" });
    return null;
  },
};

// navigator: webdriver must be genuinely read-only
const mockNavigator = Object.create(null);
Object.defineProperty(mockNavigator, "webdriver", {
    value: false, writable: false, configurable: false, enumerable: true
});

// crypto: Node's crypto provides getRandomValues
const mockCrypto = { getRandomValues(buf) { webcrypto.getRandomValues(buf); } };
```

And finally the 42 imports. They are mechanical — every name has a stable prefix and a build-hash suffix:

```javascript
imports.wbg.__wbindgen_string_new = (ptr, len) => addHeapObject(getStringFromWasm(ptr, len));
imports.wbg.__wbg_get_67b2ba62fc30de12 = (objRef, keyRef) =>
    addHeapObject(Reflect.get(getObject(objRef), getObject(keyRef)));
imports.wbg.__wbg_static_accessor_PROCESS_2c90d3b3264f2c90 = () => 0;   // hide Node
imports.wbg.__wbg_getRandomValues_bcb4912f16000dc4 = (cryptoRef, bufRef) =>
    getObject(cryptoRef).getRandomValues(getObject(bufRef));
// ... 38 more
```

The full 42-name list, and the category of each, is exactly what `wasm2node` now generates (see §9).

---

## 8. The four pitfalls that decide success or panic

Each pitfall maps to one of the wasm's environment checks. Miss one and the wasm panics — often with an error message that never mentions the real cause.

**Pitfall 1 — `navigator.webdriver` must be genuinely read-only.**

```javascript
// wrong: plain object → Reflect.set returns true → detected as automation → panic
const mockNavigator = { webdriver: false };

// right: non-writable → Reflect.set returns false → passes
const mockNavigator = Object.create(null);
Object.defineProperty(mockNavigator, "webdriver", { value: false, writable: false, configurable: false });
```

**Pitfall 2 — do not pollute `globalThis`.** Setting `global.window`/`global.Window` makes the wasm's `typeof self` / `instanceof Window` checks take the wrong branch. The golden rule of environment patching: **mocks live only at the import boundary, never on the real global.**

**Pitfall 3 — hide Node's `process`.** wasm-bindgen's crypto init has two paths: if it sees `process.versions.node` it takes `require("crypto").randomFillSync` (the Node path, which crashes against a wasm memory view); otherwise it takes `globalThis.crypto.getRandomValues` (the browser path, which works). So every Node-detection import returns 0:

```javascript
imports.wbg.__wbg_static_accessor_PROCESS_2c90d3b3264f2c90 = () => 0;
imports.wbg.__wbg_process_5c1d670bc53614b8  = () => 0;
imports.wbg.__wbg_versions_c71aa1626a93e0a1 = () => 0;
imports.wbg.__wbg_node_02999533c4ea02e3     = () => 0;
imports.wbg.__wbg_require_79b1e9274cde3c87  = () => 0;
```

**Pitfall 4 — sign the path, never the query.** `sign("/api/v1/stalls/preview", ts)`, not the full URL. Signing the query string produces a value the server rejects.

---

## 9. Result: correct signature, cross-validated two ways

For the `preview` endpoint (22-byte path):

```
len = 100
M-S = vXo5ihXchvKJ__QbuN2YvZmbtJVVthTQv1mMSVVLjh2a0IDM2MDM2YDO5EURaVFOahDOtQEO3IDT3UVWhYlVSd2dSJVTSJ1dnxDP
```

One output is not proof. Two checks:

**First, compare fixed substrings against an independent build.** A second harness — same technique, but a *different* wasm build (different sha256) — signed the same URL:

```
185lDw8l7veT__QbuN2YvZmbtJVVthTQv12cSJVLjh2a0IDM2ITOzYTOwEURaVFOahDOENWXSN3YnVlWrZlVSd2dSJVTSZDdVxDP
```

Across different timestamps and nonces, three substrings stay constant:

| fixed substring | meaning |
|---|---|
| `__QbuN2YvZmbtJVVthTQv1` | constant for a given URL (invariant to nonce/timestamp) |
| `Ljh2a0IDM2I` | same |
| `EURaVFOahD` | same |

**Second, fire a real request** with front-end-identical headers:

```
[+] Status: 200
[+] Response: { "stall_preview": { "stall_topics": [ { "id": 263, "name": "...", ... } ] } }
```

The server returns 200 with real data. Two wasm builds — `fe_sign.wasm` (sha256 `972bf383…`) and `fe_sign_bg.DLpTGLRB.wasm` (sha256 `2a2bb49c…`) — are byte-different, yet produce identical fixed fields and both pass validation. Same algorithm on both ends, different front-end build versions; the reproduction is stable, not luck.

A note on the length that nearly caused a false alarm: `M-S` length is a *function of the URL length*, not a constant. `(53 + url_len) / 3 * 4` characters. A 22-byte path → 100 chars; a 40-byte URL → 124 chars. Comparing a 100-char output against a 124-char sample from a *different* URL is comparing two different things.

---

## 10. From a one-off script to a reusable tool

The 42 imports were hand-written, but nothing about them is site-specific. The name `__wbg_get_67b2ba62fc30de12` carries a stable prefix (`__wbg_get_`) and a build hash (`67b2ba62fc30de12`). The prefix alone determines what the binding does.

So the one-off script generalizes: **read a wasm's imports, classify each name by prefix, and emit the harness.** That is `wasm2node`, in this repository.

Running it against the real `fe_sign.wasm` (not committed — third-party asset):

```
$ node bin/wasm2node.js fe_sign.wasm
[wasm2node] 42 import(s), 9 export(s)
```

Classification coverage — **0 unclassified**, and the category histogram:

```
hide-node: 5, global-accessor: 4, reflect-set: 2, call: 2,
string-new: 1, reflect-get: 1, is-function: 1, object-drop-ref: 1,
number-new: 1, crypto: 1, is-object: 1, is-string: 1, msCrypto: 1,
typedarray-new-length: 1, memory: 1, typedarray-buffer: 1,
typedarray-new-offset-length: 1, random-fill-sync: 1, typedarray-subarray: 1,
get-random-values: 1, typedarray-new: 1, object-clone-ref: 1, is-undefined: 1,
newnoargs: 1, boolean-get: 1, navigator: 1, document: 1, get-attribute: 1,
string-get: 1, throw: 1, debug-string: 1, query-selector: 1, instanceof-window: 1
```

And the generated harness instantiates the real wasm:

```
instantiate    : OK, exports = 9
has signtool_sign: true
has signtool_new : true
```

The 42 hand-written imports became 42 generated ones, verified against the same module. What took careful manual work once is now `wasm2node <file.wasm> --out harness.js`.

---

## 11. What the algorithm turned out to be (out of scope here)

A side quest on the way — disassembling the 901 KB `.wat` — identified the cipher. The key string `js-.example-ascon` contains the word "ascon", which *looked* like Ascon AEAD; but the four ChaCha20 initialization constants (`0x61707865`, `0x3320646e`, `0x79622d32`, `0x6b206574` — the words of `"expand 32-byte k"`) were present in the compiled code, and Ascon's own constants were absent. The algorithm is **ChaCha20 stream encryption + base64**, and the `ascon` in the key name is a red herring.

That investigation — *how to identify a cipher from its constants, generically* — is the subject of the sibling project `wasm-algo-fingerprint`. It is deliberately not expanded here; the two projects cover the same case from two different angles.

---

## 12. Honest boundaries

**Done**
- Black-box reproduction in Node.js: any path + timestamp → a correct `M-S`, offline, batched, no browser.
- Full inventory of the wasm's environment dependencies and the exact signing input.

**Not done / open**
- The ChaCha20 was **not** rewritten into pure JS/Python. The final signer loads the original wasm and runs it as a black box — reproduction depends on the wasm file itself.
- The key string is 18 bytes, but standard ChaCha20 uses a 32-byte key; there is a key-derivation/padding variant that was not traced to the end.
- The 53-byte fixed overhead's internal layout (nonce placement, counter init, base64 wrapping) was not reconstructed byte-by-byte — the black box doesn't need it to produce correct output.

In one sentence: **this is a working signer, not a full mathematical reconstruction of the algorithm.**

---

## 13. Retrospective

Two turns of thought mattered more than any technical trick:

1. **Demote "reverse the wasm" from a goal to a means.** The original instinct — "recover the algorithm = read the wasm" — led deeper into a 901 KB disassembly. The question that actually unblocked everything was different: *what does it eat from its environment, and what does it spit out?* Both questions yield a working signer; the cost differs by an order of magnitude.

2. **Confirm inputs are isomorphic before comparing outputs.** The "100 vs 124 characters" panic was a wrong baseline — samples from different URLs, treated as the same endpoint. Before asking "is my output right?", ask "are the inputs actually the same shape?"

> The most expensive part of reverse engineering is not the code you can't read — it is the fake problem you invented yourself. Before every round of self-doubt, run a single-variable ablation and pin the suspect down first.

---

## De-identification note

This document is de-identified. The site name and domains are replaced with `example.com` / `js-assets.example.com`; the key string with `js-.example-ascon`; the wasm with `fe_sign.wasm`. All placeholders are not real addresses. Material was taken only from publicly downloadable front-end resources; no account, cookie, or unauthorized data is involved.
