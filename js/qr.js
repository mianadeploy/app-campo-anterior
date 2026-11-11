// QR code mínimo, embutido no app (funciona sem internet): modo byte, correção de erro M, versões 1 a 10 (até 213 bytes).
// Algoritmo padrão ISO/IEC 18004. Uso: qrSvg('texto') → string SVG; qrMatriz('texto') → matriz de booleanos (true = escuro).
const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // bytes de correção por bloco (nível M), por versão
const BLOCOS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];           // nº de blocos (nível M), por versão
const brutos = v => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r >> 3; };
const capacidade = v => brutos(v) - ECC[v] * BLOCOS[v];    // bytes de dados

function mul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
function divisor(grau) {
  const r = new Array(grau).fill(0); r[grau - 1] = 1; let raiz = 1;
  for (let i = 0; i < grau; i++) { for (let j = 0; j < grau; j++) { r[j] = mul(r[j], raiz); if (j + 1 < grau) r[j] ^= r[j + 1]; } raiz = mul(raiz, 2); }
  return r;
}
function resto(dados, div) {
  const r = div.map(() => 0);
  for (const b of dados) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); }
  return r;
}

export function qrMatriz(texto) {
  const bytes = [...new TextEncoder().encode(String(texto))];
  let v = 1; while (v <= 10 && bytes.length + (v < 10 ? 2 : 3) > capacidade(v)) v++;
  if (v > 10) throw new Error('Texto longo demais para o QR');
  // dados: modo byte (0100), tamanho, bytes, terminador, preenchimento
  const bits = []; const poe = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  poe(4, 4); poe(bytes.length, v < 10 ? 8 : 16); for (const b of bytes) poe(b, 8);
  const cap = capacidade(v) * 8; poe(0, Math.min(4, cap - bits.length)); poe(0, (8 - bits.length % 8) % 8);
  for (let p = 0xEC; bits.length < cap; p ^= 0xEC ^ 0x11) poe(p, 8);
  const dados = []; for (let i = 0; i < bits.length; i += 8) dados.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  // blocos + correção de erro, intercalados
  const nb = BLOCOS[v], ecc = ECC[v], tot = brutos(v), curtos = nb - tot % nb, lenCurto = Math.floor(tot / nb), div = divisor(ecc);
  const blocos = []; let k = 0;
  for (let i = 0; i < nb; i++) {
    const d = dados.slice(k, k + lenCurto - ecc + (i < curtos ? 0 : 1)); k += d.length;
    const e = resto(d, div); if (i < curtos) d.push(0); blocos.push(d.concat(e));
  }
  const cw = [];
  for (let i = 0; i < blocos[0].length; i++) blocos.forEach((b, j) => { if (i !== lenCurto - ecc || j >= curtos) cw.push(b[i]); });
  // matriz e padrões fixos
  const n = v * 4 + 17; const M = Array.from({ length: n }, () => new Array(n).fill(false)), F = Array.from({ length: n }, () => new Array(n).fill(false));
  const fixo = (x, y, escuro) => { M[y][x] = !!escuro; F[y][x] = true; };
  for (let i = 0; i < n; i++) { fixo(6, i, i % 2 === 0); fixo(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < n && y >= 0 && y < n) fixo(x, y, d !== 2 && d !== 4);
    }
  if (v >= 2) {
    const na = Math.floor(v / 7) + 2, passo = Math.floor((v * 8 + na * 3 + 5) / (na * 4 - 4)) * 2, pos = [6];
    for (let p = n - 7; pos.length < na; p -= passo) pos.splice(1, 0, p);
    pos.forEach((cy, i) => pos.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fixo(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
  }
  const formato = masc => {
    const d = masc; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);   // nível M = 00
    const b = ((d << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) fixo(8, i, bit(i));
    fixo(8, 7, bit(6)); fixo(8, 8, bit(7)); fixo(7, 8, bit(8));
    for (let i = 9; i < 15; i++) fixo(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) fixo(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) fixo(8, n - 15 + i, bit(i));
    fixo(8, n - 8, true);
  };
  formato(0);
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const bt = ((b >>> i) & 1) !== 0, a = n - 11 + i % 3, c = Math.floor(i / 3); fixo(a, c, bt); fixo(c, a, bt); }
  }
  // dados em zigue-zague
  let i = 0;
  for (let dir = n - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const x = dir - j, sobe = ((dir + 1) & 2) === 0, y = sobe ? n - 1 - vert : vert;
      if (!F[y][x] && i < cw.length * 8) { M[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
    }
  }
  // máscara: a de menor penalidade (sequências, blocos 2×2, equilíbrio)
  const MASC = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const aplica = m => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!F[y][x] && MASC[m](x, y)) M[y][x] = !M[y][x]; };
  const penal = () => {
    let p = 0, esc = 0;
    for (let a = 0; a < n; a++) for (const lin of [0, 1]) {
      let cor = null, run = 0;
      for (let b = 0; b < n; b++) { const c = lin ? M[a][b] : M[b][a]; if (c === cor) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { cor = c; run = 1; } }
    }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (M[y][x]) esc++;
      if (x < n - 1 && y < n - 1 && M[y][x] === M[y][x + 1] && M[y][x] === M[y + 1][x] && M[y][x] === M[y + 1][x + 1]) p += 3;
    }
    return p + Math.floor(Math.abs(esc * 20 - n * n * 10) / (n * n)) * 10;
  };
  let melhor = 0, min = Infinity;
  for (let m = 0; m < 8; m++) { aplica(m); formato(m); const p = penal(); if (p < min) { min = p; melhor = m; } aplica(m); }
  aplica(melhor); formato(melhor);
  return M;
}

// SVG com margem de 4 módulos (zona de silêncio), fundo branco
export function qrSvg(texto, margem = 4) {
  const M = qrMatriz(texto), n = M.length, t = n + margem * 2; let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (M[y][x]) d += `M${x + margem},${y + margem}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
