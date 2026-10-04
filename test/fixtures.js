'use strict';

// Build a minimal, valid wasm module whose functions are all imports, so the
// tests can exercise import extraction/classification/generation without any
// real site material. The wasm binary format is public and section-structured,
// so we can assemble it by hand with a tiny LEB128 encoder.

function uleb(n) {
  n = n >>> 0;
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

const I32 = 0x7f;
const I64 = 0x7e;

function section(id, body) {
  return [id, ...uleb(body.length), ...body];
}

function encodeFuncType(ft) {
  return [0x60, ft.params.length, ...ft.params, ft.results.length, ...ft.results];
}

// imports: [{ module, name, params: [valtype], results: [valtype] }]
function buildWasm(imports) {
  const typeMap = new Map();
  const types = [];
  for (const imp of imports) {
    const key = JSON.stringify([imp.params || [], imp.results || []]);
    if (!typeMap.has(key)) {
      typeMap.set(key, types.length);
      types.push({ params: imp.params || [], results: imp.results || [] });
    }
  }

  // type section (id 1)
  const typeBody = [types.length, ...types.flatMap(encodeFuncType)];

  // import section (id 2)
  const importBody = [imports.length];
  for (const imp of imports) {
    const modBytes = [...Buffer.from(imp.module, 'utf8')];
    const nameBytes = [...Buffer.from(imp.name, 'utf8')];
    const typeIdx = typeMap.get(JSON.stringify([imp.params || [], imp.results || []]));
    importBody.push(
      modBytes.length, ...modBytes,
      nameBytes.length, ...nameBytes,
      0x00, // import kind = func
      ...uleb(typeIdx),
    );
  }

  // export section (id 7): export every imported function under its own name
  const exportBody = [imports.length];
  for (let i = 0; i < imports.length; i++) {
    const nameBytes = [...Buffer.from(imports[i].name, 'utf8')];
    exportBody.push(nameBytes.length, ...nameBytes, 0x00, ...uleb(i));
  }

  const magic = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const body = [
    ...magic,
    ...section(1, typeBody),
    ...section(2, importBody),
    ...section(7, exportBody),
  ];
  return Buffer.from(body);
}

module.exports = { buildWasm, I32, I64 };
