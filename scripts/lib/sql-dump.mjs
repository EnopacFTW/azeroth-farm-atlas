// Streaming-free parser for MySQL dumps (cmangos classic-db). Reads selected tables only.
// Values are returned as JS strings/numbers/null; SQL is never executed.

export function readTables(sql, wanted) {
  const columns = {};
  const rows = {};
  for (const t of wanted) { rows[t] = []; }

  const createRe = /CREATE TABLE `([^`]+)` \(([\s\S]*?)\n\)/g;
  let m;
  while ((m = createRe.exec(sql))) {
    if (!wanted.includes(m[1])) continue;
    columns[m[1]] = [...m[2].matchAll(/^\s+`([^`]+)`/gm)].map((x) => x[1]);
  }

  for (const table of wanted) {
    const prefix = `INSERT INTO \`${table}\` VALUES `;
    let pos = 0;
    for (;;) {
      const at = sql.indexOf(prefix, pos);
      if (at < 0) break;
      pos = parseValues(sql, at + prefix.length, rows[table]);
    }
  }
  return { columns, rows };
}

function parseValues(sql, i, out) {
  const n = sql.length;
  for (;;) {
    while (sql[i] === ' ' || sql[i] === '\n' || sql[i] === '\r') i++;
    if (sql[i] !== '(') throw new Error(`expected ( at ${i}`);
    i++;
    const row = [];
    for (;;) {
      const c = sql[i];
      if (c === "'") {
        i++;
        let s = '';
        for (;;) {
          const ch = sql[i++];
          if (ch === '\\') {
            const e = sql[i++];
            s += e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e === '0' ? '\0' : e;
          } else if (ch === "'") {
            if (sql[i] === "'") { s += "'"; i++; } else break;
          } else s += ch;
          if (i > n) throw new Error('unterminated string');
        }
        row.push(s);
      } else if (sql.startsWith('NULL', i)) {
        row.push(null);
        i += 4;
      } else {
        let j = i;
        while (sql[j] !== ',' && sql[j] !== ')') j++;
        row.push(Number(sql.slice(i, j)));
        i = j;
      }
      if (sql[i] === ',') { i++; continue; }
      if (sql[i] === ')') { i++; break; }
      throw new Error(`unexpected ${sql[i]} at ${i}`);
    }
    out.push(row);
    if (sql[i] === ',') { i++; continue; }
    if (sql[i] === ';') return i + 1;
    throw new Error(`unexpected ${sql[i]} after row at ${i}`);
  }
}

export function toObjects(columns, rows, pick) {
  const idx = pick.map((c) => {
    const k = columns.indexOf(c);
    if (k < 0) throw new Error(`missing column ${c}`);
    return k;
  });
  return rows.map((r) => {
    const o = {};
    pick.forEach((c, j) => { o[c] = r[idx[j]]; });
    return o;
  });
}
