// Safe parser for Lua table *literals* as used in QuestieDB data files.
// It never executes Lua: only {...}, [key]=, strings, numbers, nil, true, false are accepted.

export function extractLongString(source, marker) {
  // Finds `<marker> [[return { ... }]]` or `loadstring([[return {...}]])` and returns the body after `return`.
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const open = source.indexOf('[[', start);
  const close = source.indexOf(']]', open + 2);
  if (open < 0 || close < 0) throw new Error(`long string not found after ${marker}`);
  const body = source.slice(open + 2, close).trim();
  if (!body.startsWith('return')) throw new Error('long string does not start with return');
  return body.slice('return'.length);
}

export function parseLuaTable(text) {
  let i = 0;
  const n = text.length;

  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) { i++; continue; }
      if (text.startsWith('--', i)) { // line comment
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      break;
    }
  };

  const fail = (msg) => { throw new Error(`${msg} at ${i}: ${JSON.stringify(text.slice(i, i + 40))}`); };

  const parseString = () => {
    const q = text[i++];
    let out = '';
    while (i < n) {
      const c = text[i++];
      if (c === q) return out;
      if (c === '\\') {
        const e = text[i++];
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'r') out += '\r';
        else if (e >= '0' && e <= '9') {
          let d = e;
          while (d.length < 3 && text[i] >= '0' && text[i] <= '9') d += text[i++];
          out += String.fromCharCode(Number(d));
        } else out += e;
      } else out += c;
    }
    fail('unterminated string');
  };

  const parseNumber = () => {
    const m = /^-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+)/.exec(text.slice(i, i + 40));
    if (!m) fail('bad number');
    i += m[0].length;
    return Number(m[0]);
  };

  const parseValue = () => {
    ws();
    const c = text[i];
    if (c === '{') return parseTable();
    if (c === '"' || c === "'") return parseString();
    if (c === '-' || c === '.' || (c >= '0' && c <= '9')) return parseNumber();
    if (text.startsWith('nil', i)) { i += 3; return null; }
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    fail('unexpected token');
  };

  // Tables are returned as { arr: [...], map: Map } collapsed: pure arrays -> Array, keyed -> Object.
  const parseTable = () => {
    i++; // {
    const arr = [];
    let obj = null;
    let pos = 1;
    for (;;) {
      ws();
      if (text[i] === '}') { i++; break; }
      let key;
      if (text[i] === '[') {
        i++;
        key = parseValue();
        ws();
        if (text[i] !== ']') fail('expected ]');
        i++;
        ws();
        if (text[i] !== '=') fail('expected =');
        i++;
      } else {
        const m = /^[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)/.exec(text.slice(i, i + 80));
        if (m) { key = m[0].replace(/\s*=$/, ''); i += m[0].length; }
      }
      const value = parseValue();
      if (key === undefined) {
        arr[pos - 1] = value;
        pos++;
      } else {
        obj ??= {};
        obj[key] = value;
      }
      ws();
      if (text[i] === ',' || text[i] === ';') { i++; continue; }
      if (text[i] === '}') { i++; break; }
      fail('expected , or }');
    }
    if (!obj) return arr;
    arr.forEach((v, idx) => { obj[idx + 1] = v; });
    return obj;
  };

  ws();
  const v = parseValue();
  return v;
}
