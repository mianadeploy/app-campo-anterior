// Kanban por atividade (ciclo 11) – lógica e desenho únicos, usados pelo app (aba Quadro) e pelo painel do escritório
// (tools/dashboard.py embute este arquivo no HTML do painel). Código genérico: não cita projeto, cliente nem local.
//
// Colunas = as atividades, na ordem das etapas, com o Crated como coluna própria antes do embarque:
//   0 A conferir · 1 Conferido · 2 Preparado · 3 Desceu · 4 Na doca · 5 Crated · 6 Embarcado
// Volume (v): { id, tag, equip, lote, nivel, sala, vol, xy:[x,y], caixa, c:[5 etapas], elev, cr:'S'|'NA'|'', esc:'ativo'|'fora'|'diverg',
//               motivo, reg (tem algum registro), t:[hora de cada etapa, ms], q:[quem], cr_t, cr_q, foto (chave da miniatura), nf, onde, aloc }
// Posição do volume = a última atividade feita em sequência (etapa que não se aplica é pulada: "Desceu" para quem não usa o elevador,
// "Crated" para quem está com "não se aplica"). Cartão = equipamento; fica na coluna da ETAPA EM ANDAMENTO (ciclo 11b – ver kbColuna).
export const KB_COLS = ['A conferir', 'Conferido', 'Preparado', 'Desceu', 'Na doca', 'Crated', 'Embarcado'];
// o que o nº de volumes por etapa quer dizer no alto de cada coluna (bate com o total do resumo)
export const KB_FEITO = ['ainda a conferir', 'conferidos', 'preparados', 'desceram', 'na doca', 'crated', 'embarcados'];
export const KB_COR = ['#d3d6dc', '#a9cdf6', '#2a78d6', '#7b3fa0', '#f0a030', '#0e8f8f', '#0ca30c'];
const kbFeito = (v, j) => (j === 5 ? v.cr === 'S' : j === 6 ? !!v.c[4] : !!v.c[j - 1]);
const kbAplica = (v, j) => !(j === 3 && !v.elev) && !(j === 5 && v.cr === 'NA');
export function kbPos(v) { let p = 0; for (let j = 1; j <= 6; j++) { if (!kbAplica(v, j)) continue; if (kbFeito(v, j)) p = j; else break; } return p; }
export function kbProx(v) { for (let j = 1; j <= 6; j++) if (kbAplica(v, j) && !kbFeito(v, j)) return j; return 7; }
const kbHora = (v, j) => (j === 5 ? v.cr_t : j === 6 ? (v.t || [])[4] : (v.t || [])[j - 1]) || 0;
const kbQuem = (v, j) => (j === 5 ? v.cr_q : j === 6 ? (v.q || [])[4] : (v.q || [])[j - 1]) || '';
const kbP2 = n => String(n).padStart(2, '0');
export const kbData = ts => { if (!ts) return ''; const d = new Date(ts); return `${kbP2(d.getDate())}/${kbP2(d.getMonth() + 1)} ${kbP2(d.getHours())}:${kbP2(d.getMinutes())}`; };
export const kbVol = v => (v.xy && v.xy.length === 2 ? `vol. ${v.xy[0]}/${v.xy[1]}` : 'vol.');
const kbEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// alertas de um volume: pulou etapa (uma etapa feita com outra anterior, que se aplica, por fazer), embarcado sem crated,
// etapa marcada sem hora no histórico (o registro "não pegou" inteiro)
export function kbAlertas(v) {
  const a = []; const seq = [1, 2, 3, 4, 6].filter(j => kbAplica(v, j));
  for (let i = 0; i < seq.length; i++) if (kbFeito(v, seq[i]) && seq.slice(0, i).some(j => !kbFeito(v, j))) { a.push(`pulou etapa: ${KB_COLS[seq[i]]} sem ${KB_COLS[seq.slice(0, i).find(j => !kbFeito(v, j))]}`); break; }
  if (v.c[4] && !v.cr) a.push('embarcado sem crated');
  if (seq.some(j => kbFeito(v, j) && !kbHora(v, j))) a.push('etapa marcada sem hora no histórico');
  return a;
}
// Ciclo 11b – regra da coluna do cartão (equipamento), pelos volumes no escopo:
//   · etapa EM ANDAMENTO = a primeira etapa, na ordem, que ainda não está completa em todos os volumes a que se aplica E que já foi feita em
//     pelo menos um. O cartão fica nessa coluna, com a barra "feitos/total" dela e "falta: vol. X/Y". (Antes: a coluna do volume mais
//     atrasado – um volume sem registro segurava o equipamento inteiro em "A conferir".)
//   · nenhuma etapa em andamento: o cartão fica na coluna da última etapa completa em todos os volumes (em sequência, a partir da 1ª), com
//     "concluído em DD/MM HH:MM (quem)"; se nenhuma está completa, "A conferir".
//   · Crated pode ser feito antes da hora: só conta como etapa em andamento quando as etapas anteriores já estão completas.
// kbEtapas(at) -> [{ j, tot, feitos, completa }] para j = 1..6 (tot = volumes a que a etapa se aplica)
export function kbEtapas(at) {
  return [1, 2, 3, 4, 5, 6].map(j => { const ap = at.filter(v => kbAplica(v, j)), feitos = ap.filter(v => kbFeito(v, j)).length; return { j, tot: ap.length, feitos, completa: ap.length > 0 && feitos === ap.length }; });
}
export function kbColuna(at) {
  const E = kbEtapas(at); let base = 0;   // base = última etapa completa em sequência (a que não se aplica a volume nenhum é pulada)
  for (const e of E) { if (!e.tot) continue; if (e.completa) base = e.j; else break; }
  const and = E.find(e => e.tot && e.feitos > 0 && !e.completa && (e.j !== 5 || E.slice(0, 4).every(x => !x.tot || x.completa)));
  return { col: and ? and.j : base, andamento: !!and, base, E };
}
// f: { lote, nivel, sala, et (coluna), pend } – filtros. Devolve { cols: [{ k, nome, cards, nv, nfe }], fora, div, nEq, nVol, lotes, niveis, salas }
//   nv = volumes dos cartões da coluna; nfe = volumes (de todos os cartões que passam no filtro) com a etapa da coluna feita – é o número que
//   bate com o total do resumo (ex.: "75 conferidos"); na coluna 0, os que ainda não foram conferidos.
export function kbModelo(itens, f = {}) {
  const eq = new Map();
  for (const v of itens) { if (!eq.has(v.tag)) eq.set(v.tag, []); eq.get(v.tag).push(v); }
  const cols = KB_COLS.map((nome, k) => ({ k, nome, cards: [], nv: 0, nfe: 0 })), fora = [], div = [];
  for (const [tag, vs] of eq) {
    const at = vs.filter(v => v.esc === 'ativo'), vf = vs.filter(v => v.esc === 'fora'), vd = vs.filter(v => v.esc === 'diverg');
    const base = { tag, equip: vs[0].equip || '', lote: vs[0].lote || '—', vs, at, nFora: vf.length, nDiv: vd.length };
    const passa = (!f.lote || base.lote === f.lote) && (!f.nivel || vs.some(v => v.nivel === f.nivel)) && (!f.sala || vs.some(v => v.sala === f.sala));
    if (!passa) continue;
    if (vf.length) fora.push({ ...base, lista: vf });
    if (vd.length) div.push({ ...base, lista: vd });
    if (!at.length) continue;
    const K = kbColuna(at), col = K.col, e = col >= 1 ? K.E[col - 1] : null;
    const c = { ...base, col, prox: col, andamento: K.andamento };
    if (e) { c.tot = e.tot; c.feitos = e.feitos; c.faltam = at.filter(v => kbAplica(v, col) && !kbFeito(v, col)); }
    else { c.tot = at.length; c.feitos = 0; c.faltam = []; }   // "A conferir": nenhum volume com etapa nenhuma
    const ok = K.andamento ? K.base : col;   // a etapa completa em todos os volumes: hora do último e quem
    if (ok >= 1) {
      const ap = at.filter(v => kbAplica(v, ok)), hs = ap.map(v => kbHora(v, ok)), ult = ap.length && hs.every(Boolean) ? ap[hs.indexOf(Math.max(...hs))] : null;
      c.concl = { nome: KB_COLS[ok], ts: ult ? kbHora(ult, ok) : 0, quem: ult ? kbQuem(ult, ok) : '' };
    }
    const comReg = at.some(v => v.reg);
    c.alertas = [];
    for (const v of at) {
      const a = kbAlertas(v); if (comReg && !v.reg && c.feitos * 2 >= c.tot) a.push('sem registro nenhum');   // a maioria já foi feita e este não tem nada: provável marcação que não pegou
      v._al = a; if (a.length) c.alertas.push({ v, a });
    }
    c.emAndamento = K.andamento;
    if (f.pend && !c.emAndamento && !c.alertas.length) continue;
    if (f.et !== undefined && f.et !== '' && +f.et !== col) continue;
    cols[col].cards.push(c); cols[col].nv += at.length;
    for (let j = 1; j <= 6; j++) cols[j].nfe += at.filter(v => kbFeito(v, j)).length;
    cols[0].nfe += at.filter(v => !kbFeito(v, 1)).length;
  }
  const ord = (a, b) => String(a.lote).localeCompare(String(b.lote)) || a.tag.localeCompare(b.tag);
  for (const c of cols) c.cards.sort(ord); fora.sort(ord); div.sort(ord);
  const uniq = l => [...new Set(l.filter(Boolean))].sort();
  return { cols, fora, div, nEq: cols.reduce((s, c) => s + c.cards.length, 0), nVol: cols.reduce((s, c) => s + c.nv, 0),
    lotes: uniq(itens.map(v => v.lote)), niveis: uniq(itens.map(v => v.nivel)), salas: uniq(itens.map(v => v.sala)) };
}
function kbLinhaVol(v) {
  const p = v.esc === 'ativo' ? kbPos(v) : -1, al = v._al || [];
  const feitas = [1, 2, 3, 4, 5, 6].filter(j => kbAplica(v, j) && kbFeito(v, j)).map(j => `<span class="kb-e"><i style="background:${KB_COR[j]}"></i>${KB_COLS[j]}${kbHora(v, j) ? ' ' + kbData(kbHora(v, j)) : ''}${kbQuem(v, j) ? ' · ' + kbEsc(kbQuem(v, j)) : ''}</span>`).join('');
  const sit = v.esc === 'fora' ? `fora do escopo${v.motivo ? ': ' + kbEsc(v.motivo) : ''}` : v.esc === 'diverg' ? `divergência${v.motivo ? ': ' + kbEsc(v.motivo) : ''}` : KB_COLS[p];
  return `<button type="button" class="kb-v${v.esc !== 'ativo' ? ' kb-x-' + v.esc : ''}${al.length ? ' kb-val' : ''}${v.aloc ? ' kb-aloc' : ''}" data-kbv="${kbEsc(v.id)}">
    ${v.foto ? `<img class="kb-th" data-kbfoto="${kbEsc(v.foto)}" alt="">` : '<span class="kb-th kb-sem">sem foto</span>'}
    <span class="kb-vt"><b>${kbVol(v)}</b> ${kbEsc(v.vol || '—')}${v.caixa ? ` <small>${kbEsc(v.caixa)}</small>` : ''}
      <span class="kb-sit" style="--c:${p >= 0 ? KB_COR[p] : '#8a8f99'}">${sit}</span>${v.esc === 'ativo' ? `<span class="kb-cr">Crated: ${v.cr === 'S' ? 'sim' : v.cr === 'NA' ? 'não se aplica' : 'não'}</span>` : ''}${v.nf ? `<span class="kb-nf">${v.nf} foto${v.nf === 1 ? '' : 's'}</span>` : ''}
      <span class="kb-es">${feitas || (v.esc === 'ativo' ? '<span class="kb-e">nenhuma etapa registrada</span>' : '')}</span>
      ${al.length ? `<span class="kb-al">⚠ ${al.map(kbEsc).join(' · ')}</span>` : ''}${v.aloc ? '<span class="kb-al kb-loc">A LOCALIZAR</span>' : ''}</span></button>`;
}
const kbFaltaVol = v => kbVol(v) + (v.aloc && !v.reg ? ' (A LOCALIZAR)' : '');
function kbCartao(c, abertos) {
  const ab = abertos && abertos.has(c.tag), nomeEt = KB_COLS[c.col], pc = c.tot ? Math.round(c.feitos / c.tot * 100) : 0;
  const falt = c.faltam || [];
  return `<div class="kb-card${c.alertas.length ? ' kb-alerta' : ''}${ab ? ' kb-aberto' : ''}" data-kb="${kbEsc(c.tag)}" data-col="${c.col}">
    <button type="button" class="kb-top" data-kbx="${kbEsc(c.tag)}" aria-expanded="${ab ? 'true' : 'false'}"><b>${kbEsc(c.tag)}</b><span class="kb-nm">${kbEsc(c.equip)}</span><small>${c.at.length} vol. ${ab ? '▴' : '▾'}</small></button>
    <div class="kb-bar" title="${nomeEt}: ${c.feitos} de ${c.tot}"><i style="width:${pc}%;background:${KB_COR[c.col]}"></i></div>
    <div class="kb-l1" data-kbprog="${c.feitos}/${c.tot}"><b>${c.col ? `${nomeEt} ${c.feitos}/${c.tot}` : `A conferir · ${c.tot} vol.`}</b></div>
    ${c.concl ? `<div class="kb-ok" data-kbconcl="${c.concl.ts || 0}">✔ ${c.concl.nome}: concluído ${c.concl.ts ? 'em ' + kbData(c.concl.ts) : '(sem hora no histórico)'}${c.concl.quem ? ' (' + kbEsc(c.concl.quem) + ')' : ''}</div>` : ''}
    ${falt.length && c.feitos ? `<div class="kb-falta" data-kbfalta="${falt.length}">${falt.length === 1 ? 'falta' : 'faltam ' + falt.length}: ${falt.slice(0, 8).map(kbFaltaVol).join(', ')}${falt.length > 8 ? '…' : ''}</div>` : ''}
    ${c.alertas.length ? `<div class="kb-al" data-kbal="${c.alertas.length}">⚠ ${c.alertas.slice(0, 3).map(x => `${kbVol(x.v)}: ${x.a.map(kbEsc).join(', ')}`).join(' · ')}${c.alertas.length > 3 ? ` · e mais ${c.alertas.length - 3}` : ''}</div>` : ''}
    ${c.nFora || c.nDiv ? `<div class="kb-nota">${[c.nFora ? `${c.nFora} fora do escopo` : '', c.nDiv ? `${c.nDiv} em divergência` : ''].filter(Boolean).join(' · ')} (à parte)</div>` : ''}
    ${ab ? `<div class="kb-vols">${c.vs.map(kbLinhaVol).join('')}</div>` : ''}</div>`;
}
function kbFaixa(lista, classe, titulo, sub, abertos) {
  if (!lista.length) return '';
  return `<section class="kb-faixa ${classe}" data-kbfaixa="${classe}"><h3>${titulo} <small>${lista.reduce((s, c) => s + c.lista.length, 0)} volume(s) em ${lista.length} equipamento(s) · ${sub}</small></h3><div class="kb-fx">${lista.map(c => {
    const ab = abertos && abertos.has(classe + ':' + c.tag);
    return `<div class="kb-card kb-cx${ab ? ' kb-aberto' : ''}" data-kbf="${kbEsc(c.tag)}"><button type="button" class="kb-top" data-kbx="${classe}:${kbEsc(c.tag)}"><b>${kbEsc(c.tag)}</b><span class="kb-nm">${kbEsc(c.equip)}</span><small>${c.lista.length} de ${c.vs.length} vol. ${ab ? '▴' : '▾'}</small></button>
      ${c.lista.length < c.vs.length ? `<div class="kb-nota">os outros ${c.vs.length - c.lista.length} volume(s) deste equipamento continuam no escopo</div>` : ''}${ab ? `<div class="kb-vols">${c.lista.map(kbLinhaVol).join('')}</div>` : ''}</div>`; }).join('')}</div></section>`;
}
// HTML do quadro. abertos: Set com as tags dos cartões expandidos. Quem usa liga os cliques: [data-kbx] expande, [data-kbv] abre o volume,
// e preenche as miniaturas img[data-kbfoto].
export function kbHtml(m, abertos) {
  const col = c => { let lt = null;
    return `<section class="kb-col${c.cards.length ? '' : ' kb-vazia'}" data-kbcol="${c.k}"><h3><i style="background:${KB_COR[c.k]}"></i>${c.nome}<small data-kbnv="${c.nv}">${c.cards.length} equip. · ${c.nv} vol.</small><small class="kb-nfe" data-kbnfe="${c.nfe}">${c.nfe} vol. ${KB_FEITO[c.k]}</small></h3>${
      c.cards.map(x => { const cab = x.lote !== lt ? `<div class="kb-lote">Lote ${kbEsc(x.lote)}</div>` : ''; lt = x.lote; return cab + kbCartao(x, abertos); }).join('') || '<p class="kb-nada">—</p>'}</section>`; };
  // em tela larga os volumes do cartão aberto aparecem num quadro de largura inteira, acima das colunas (dentro da coluna ficaria estreito);
  // em tela estreita (celular) aparecem dentro do próprio cartão
  const det = m.cols.flatMap(c => c.cards).filter(c => abertos && abertos.has(c.tag)).map(c => `<section class="kb-det" data-kbdet="${kbEsc(c.tag)}"><h3><i style="background:${KB_COR[c.col]}"></i>${kbEsc(c.tag)} <span>${kbEsc(c.equip)} · lote ${kbEsc(c.lote)} · ${c.at.length} volume(s) · ${KB_COLS[c.col]}</span><button type="button" data-kbx="${kbEsc(c.tag)}">fechar ✕</button></h3><div class="kb-vols">${c.vs.map(kbLinhaVol).join('')}</div></section>`).join('');
  return `${det}<div class="kb" id="kb">${m.cols.map(col).join('')}</div>`
    + kbFaixa(m.div, 'kb-div', 'Divergências', 'não entram nos totais', abertos)
    + kbFaixa(m.fora, 'kb-fora', 'Fora do escopo', 'motivo documentado; não entram nos totais', abertos);
}
export const KB_CSS = `
.kb{display:grid;grid-template-columns:repeat(7,minmax(170px,1fr));gap:8px;align-items:start;overflow-x:auto;padding-bottom:6px}
.kb-col{background:#e9edf3;border-radius:10px;padding:6px;min-width:0}.kb-col h3{margin:2px 4px 6px;font-size:13px;color:#1F3864;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.kb-col h3 i{width:11px;height:11px;border-radius:3px;border:1px solid rgba(0,0,0,.3);display:inline-block}.kb-col h3 small,.kb-faixa h3 small{font-weight:400;color:#52514e;font-size:11px}.kb-col h3 small.kb-nfe{flex-basis:100%;color:#1F3864;font-weight:700}
.kb-lote{font-size:11px;font-weight:700;color:#52514e;margin:6px 4px 3px;text-transform:uppercase;letter-spacing:.3px}.kb-nada{color:#898781;margin:4px;font-size:12px}
.kb-card{background:#fff;border:1px solid #cfd5df;border-left:5px solid #9aa3b2;border-radius:8px;margin-bottom:6px;font-size:12px;line-height:1.3;color:#0b0b0b;overflow:hidden}
.kb-card.kb-alerta{border-left-color:#d03b3b}.kb-card.kb-aberto{box-shadow:0 2px 10px rgba(0,0,0,.18)}
.kb-top{all:unset;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:2px 6px;align-items:baseline;width:100%;padding:7px 8px 4px;cursor:pointer;min-height:40px}
.kb-top b{font-size:13.5px}.kb-top .kb-nm{color:#52514e;flex:1 1 60px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kb-top small{color:#52514e;font-size:11px;white-space:nowrap}
.kb-bar{height:7px;background:#e3e6ec;border-radius:4px;margin:0 8px;overflow:hidden}.kb-bar i{display:block;height:100%;border-radius:4px}
.kb-l1,.kb-ok,.kb-falta,.kb-card>.kb-al,.kb-nota{padding:2px 8px}.kb-l1{padding-top:4px}.kb-ok{color:#0a6b0a}.kb-falta{color:#8a4b00}.kb-al{color:#b71c1c;font-weight:700}.kb-nota{color:#52514e;font-style:italic}
.kb-card>div:last-child{padding-bottom:7px}
.kb-vols{border-top:1px solid #e1e4ea;margin-top:5px;padding:0 !important}
.kb-v{all:unset;box-sizing:border-box;display:flex;gap:8px;align-items:flex-start;width:100%;padding:6px 8px;border-bottom:1px solid #eef0f4;cursor:pointer;min-height:44px}
.kb-v:hover{background:#f4f7fb}.kb-v.kb-val{background:#fff4f3}.kb-v.kb-aloc{background:#fff8d6}
.kb-v.kb-x-fora{background:repeating-linear-gradient(45deg,#eceef1,#eceef1 6px,#dcdfe5 6px,#dcdfe5 12px);color:#52514e}
.kb-th{width:46px;height:36px;object-fit:cover;border-radius:5px;border:1px solid #cfd5df;flex:0 0 46px;background:#eef1f5}.kb-sem{display:flex;align-items:center;justify-content:center;font-size:9px;color:#898781;text-align:center;line-height:1}
.kb-vt{flex:1;min-width:0;display:block}.kb-vt small{color:#52514e}.kb-sit{display:inline-block;margin-left:4px;padding:0 6px;border-radius:9px;font-size:10.5px;font-weight:700;background:var(--c);color:#0b0b0b;border:1px solid rgba(0,0,0,.2)}
.kb-cr,.kb-nf{margin-left:6px;font-size:10.5px;color:#52514e}.kb-es{display:block;font-size:10.5px;color:#30302e;margin-top:2px}.kb-e{display:inline-block;margin-right:8px;white-space:nowrap}
.kb-e i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:3px;border:1px solid rgba(0,0,0,.3)}.kb-v .kb-al{display:block;font-size:10.5px}.kb-loc{color:#8a4b00}
.kb-det{background:#fff;border:2px solid #1F3864;border-radius:10px;margin:0 0 10px;overflow:hidden}.kb-det h3{margin:0;padding:8px 10px;font-size:14px;color:#1F3864;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#eef1f5}
.kb-det h3 i{width:12px;height:12px;border-radius:3px;border:1px solid rgba(0,0,0,.3)}.kb-det h3 span{font-weight:400;color:#52514e;font-size:12px;flex:1}.kb-det h3 button{all:unset;cursor:pointer;font-size:12px;padding:4px 8px;border:1px solid #cfd5df;border-radius:6px;background:#fff}
.kb-det .kb-vols{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));border:0;margin:0}.kb-det .kb-v{border-right:1px solid #eef0f4}
.kb-col .kb-card>.kb-vols{display:none}
.kb-faixa{margin-top:10px;border-radius:10px;padding:8px 10px;border:1px solid #cfd5df}.kb-faixa h3{margin:0 0 6px;font-size:13px;color:#30302e}
.kb-faixa.kb-fora{background:repeating-linear-gradient(45deg,#e6e8ec,#e6e8ec 8px,#d5d8de 8px,#d5d8de 16px)}.kb-faixa.kb-div{background:#fdecea;border-color:#f0b8b4}
.kb-fx{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start}.kb-fx .kb-card{margin:0;width:230px;max-width:100%;border-left-color:#8a8f99}.kb-div .kb-card{border-left-color:#d03b3b}.kb-fx .kb-card.kb-aberto{width:min(520px,100%)}
@media (max-width:1100px){.kb{grid-template-columns:repeat(7,minmax(200px,1fr))}}
@media (max-width:720px){.kb-det{display:none}.kb-col .kb-card>.kb-vols{display:block}.kb{display:block;overflow:visible}.kb-col{margin-bottom:8px}.kb-col.kb-vazia{padding:2px 6px}.kb-col.kb-vazia h3{margin:4px;opacity:.7}.kb-col.kb-vazia .kb-nada{display:none}.kb-fx .kb-card,.kb-fx .kb-card.kb-aberto{width:100%}.kb-top{min-height:46px}}
`;
