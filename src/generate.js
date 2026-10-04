'use strict';

const { PREAMBLE } = require('./runtime');

const DEFAULT_ENV = `// Default mock environment. Override per-site values (favicon href, keywords, etc.)
// by passing your own env object to loadWasm(). Keep it out of globalThis — the
// whole point is that mocks live only at the import boundary.
function defaultEnv() {
  const makeElement = (attrs) => {
    const el = { getAttribute: (name) => attrs[name] ?? null };
    for (const k in attrs) el[k] = attrs[k];
    return el;
  };
  const document = {
    querySelector: () => null, // serve favicon / keywords in a custom env
  };
  const navigator = Object.create(null);
  Object.defineProperty(navigator, 'webdriver', {
    value: false, writable: false, configurable: false, enumerable: true,
  });
  return { document, navigator, crypto: globalThis.crypto };
}
`;

// Map a category to the body of a single import implementation.
// The emitted code runs inside buildImports(), so it closes over env, wasm,
// addHeapObject, getObject, getStringFromWasm, passStringToWasm, etc.
function implFor(imp) {
  switch (imp.category) {
    case 'string-new':
      return `(ptr, len) => addHeapObject(getStringFromWasm(ptr, len))`;
    case 'string-get':
      return `(outPtr, objRef) => {
    const s = getObject(objRef);
    const str = typeof s === 'string' ? s : undefined;
    if (str === undefined) {
      getDataView().setInt32(outPtr + 4, 0, true);
      getDataView().setInt32(outPtr + 0, 0, true);
      return;
    }
    const { ptr, len } = passStringToWasm(str, wasm.__wbindgen_export_1, wasm.__wbindgen_export_2);
    getDataView().setInt32(outPtr + 4, len, true);
    getDataView().setInt32(outPtr + 0, ptr, true);
  }`;
    case 'object-clone-ref':
      return `(idx) => idx`;
    case 'object-drop-ref':
      return `(idx) => {}`;
    case 'is-undefined':
      return `(idx) => (getObject(idx) === undefined ? 1 : 0)`;
    case 'is-object':
      return `(idx) => { const o = getObject(idx); return (typeof o === 'object' && o !== null) ? 1 : 0; }`;
    case 'is-string':
      return `(idx) => (typeof getObject(idx) === 'string' ? 1 : 0)`;
    case 'is-function':
      return `(idx) => (typeof getObject(idx) === 'function' ? 1 : 0)`;
    case 'boolean-get':
      return `(idx) => { const o = getObject(idx); return typeof o === 'boolean' ? (o ? 1 : 0) : 2; }`;
    case 'number-new':
      return `(f) => addHeapObject(f)`;
    case 'debug-string':
      return `(outPtr, objRef) => {
    const s = debugString(getObject(objRef));
    const { ptr, len } = passStringToWasm(s, wasm.__wbindgen_export_1, wasm.__wbindgen_export_2);
    getDataView().setInt32(outPtr + 4, len, true);
    getDataView().setInt32(outPtr + 0, ptr, true);
  }`;
    case 'throw':
      return `(ptr, len) => { throw new Error(getStringFromWasm(ptr, len)); }`;
    case 'memory':
      return `() => addHeapObject(wasm.memory)`;
    case 'reflect-get':
      return `(objRef, keyRef) => {
    const key = getObject(keyRef);
    const obj = getObject(objRef);
    if (obj == null || (typeof obj !== 'object' && typeof obj !== 'function')) return 0;
    return addHeapObject(Reflect.get(obj, key));
  }`;
    case 'reflect-set':
      return `(objRef, keyRef, valRef) => {
    const obj = getObject(objRef), key = getObject(keyRef), val = getObject(valRef);
    Reflect.set(obj, key, val);
    return 0;
  }`;
    case 'global-accessor':
      return `() => addHeapObject(env)`;
    case 'hide-node':
      return `() => 0`;
    case 'call':
      return `(fnRef, argRef) => {
    const fn = getObject(fnRef), a = getObject(argRef);
    return addHeapObject(fn.call(a));
  }`;
    case 'newnoargs':
      return `(ptr, len) => addHeapObject(new Function(getStringFromWasm(ptr, len)))`;
    case 'typedarray-new-length':
      return `(len) => addHeapObject(new Uint8Array(len >>> 0))`;
    case 'typedarray-new':
      return `(initRef) => addHeapObject(new Uint8Array(getObject(initRef)))`;
    case 'typedarray-new-offset-length':
      return `(bufRef, offset, len) => addHeapObject(new Uint8Array(getObject(bufRef), offset >>> 0, len >>> 0))`;
    case 'typedarray-buffer':
      return `(objRef) => addHeapObject(getObject(objRef).buffer)`;
    case 'typedarray-subarray':
      return `(bufRef, offset, len) => addHeapObject(getObject(bufRef).subarray(offset >>> 0, len >>> 0))`;
    case 'get-random-values':
      return `(cryptoRef, bufRef) => { getObject(cryptoRef).getRandomValues(getObject(bufRef)); }`;
    case 'random-fill-sync':
      return `(objRef, bufRef) => { getObject(objRef).randomFillSync(getObject(bufRef)); }`;
    case 'crypto':
      return `(objRef) => { const c = getObject(objRef).crypto || globalThis.crypto; return c ? addHeapObject(c) : 0; }`;
    case 'mscrypto':
      return `(objRef) => { const c = getObject(objRef).msCrypto; return c ? addHeapObject(c) : 0; }`;
    case 'document':
      return `(objRef) => { const d = getObject(objRef).document; return d ? addHeapObject(d) : 0; }`;
    case 'navigator':
      return `(objRef) => { const n = getObject(objRef).navigator; return n ? addHeapObject(n) : 0; }`;
    case 'query-selector':
      return `(docRef, selPtr, selLen) => {
    const sel = getStringFromWasm(selPtr, selLen);
    const r = getObject(docRef).querySelector(sel);
    return r ? addHeapObject(r) : 0;
  }`;
    case 'get-attribute':
      return `(outPtr, elRef, attrPtr, attrLen) => {
    const attr = getStringFromWasm(attrPtr, attrLen);
    const r = getObject(elRef).getAttribute(attr);
    if (r == null) {
      getDataView().setInt32(outPtr + 4, 0, true);
      getDataView().setInt32(outPtr + 0, 0, true);
      return;
    }
    const { ptr, len } = passStringToWasm(r, wasm.__wbindgen_export_1, wasm.__wbindgen_export_2);
    getDataView().setInt32(outPtr + 4, len, true);
    getDataView().setInt32(outPtr + 0, ptr, true);
  }`;
    case 'instanceof-window':
      return `(objRef) => (getObject(objRef) instanceof (globalThis.Window || Object) ? 1 : 0)`;
    case 'unknown':
      return `() => 0;  // TODO: unclassified import '${imp.name}' — implement if the wasm calls it`;
    default:
      return `() => 0;  // TODO: unhandled category '${imp.category}'`;
  }
}

function groupByModule(imports) {
  const byModule = new Map();
  for (const imp of imports) {
    if (!byModule.has(imp.module)) byModule.set(imp.module, []);
    byModule.get(imp.module).push(imp);
  }
  return byModule;
}

// Generate a complete, standalone harness file.
function generate(analysis) {
  const byModule = groupByModule(analysis.imports);
  const lines = [];

  lines.push(PREAMBLE.trimEnd());
  lines.push('');
  lines.push(DEFAULT_ENV.trimEnd());
  lines.push('');

  lines.push('function buildImports(env) {');
  lines.push('  const imports = {};');
  lines.push('  const wbg = {};');
  for (const imp of byModule.get('wbg') || []) {
    lines.push(`  wbg['${imp.name}'] = ${implFor(imp)};`);
  }
  lines.push('  imports.wbg = wbg;');
  for (const [mod, imps] of byModule) {
    if (mod === 'wbg') continue;
    lines.push(`  imports['${mod}'] = {};`);
    for (const imp of imps) {
      lines.push(`  imports['${mod}']['${imp.name}'] = () => 0;  // non-wbg import, stubbed`);
    }
  }
  lines.push('  return imports;');
  lines.push('}');
  lines.push('');

  lines.push(`async function loadWasm(wasmBytes, env = defaultEnv()) {
  const imports = buildImports(env);
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  wasm = instance.exports;
  return wasm;
}`);
  lines.push('');
  lines.push('module.exports = { loadWasm, buildImports, defaultEnv };');
  lines.push('');

  return lines.join('\n');
}

module.exports = { generate, implFor };
