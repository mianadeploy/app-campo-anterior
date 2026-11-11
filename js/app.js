// App de Campo · Miana Consulting – código genérico; nomes de projeto/cliente vêm do pacote de dados
import * as DB from './db.js';
import { makeZip, readZip } from './zip.js';
import { qrSvg } from './qr.js';

export const APP_VERSION = '1.5.0';
const ACEITA_PACOTE = '.zip,.json,application/zip,application/x-zip-compressed,application/json,application/octet-stream';
const ETAPAS = ['Conferido', 'Preparado', 'Desceu', 'Na doca', 'Embarcado'];
const PROX = ['1 Conferir', '2 Preparar', '3 Descer', '4 Levar à doca', '5 Embarcar', '6 Embarcado'];
// motivos e rótulos de escopo: do pacote de dados (seed.escopo); aqui só o padrão genérico
const ESCOPO_PADRAO = { motivos_fora: ['Lote anterior (já retirado)', 'Duplicado na lista', 'Outro (documentado)'],
  motivos_diverg: ['Não encontrado', 'Não está no site'], rotulo_fora: 'Fora do escopo (motivo documentado)', rotulo_diverg: 'Não encontrado / não está no site' };
const ESC = () => ({ ...ESCOPO_PADRAO, ...((S.seed && S.seed.escopo) || {}) });
const S = { seed: null, itens: [], byId: new Map(), estado: new Map(), meta: {}, planta: 'L0', view: 'planta',
            zoom: { s: 1, x: 0, y: 0 }, painel: null, plantaUrls: {}, salasEd: [], edit: false, draw: null,
            filtro: null, abertos: {}, det: false, detIt: new Set(), eqSel: null, fq: {}, alias: {}, aliasInv: {}, fotosSala: new Map(), thumbUrl: new Map(), ultPac: null };
const $ = (sel, el = document) => el.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const fmtD = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hoje = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const slug = s => String(s || '').replace(/[^A-Za-z0-9]+/g, '');
// nome de arquivo válido no Windows/OneDrive: sem \ / : * ? " < > | nem caracteres de controle
export const nomeArq = s => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-. ]+|[-. ]+$/g, '') || 'sem-nome';
// foto de sala de pacotes antigos (…_SALA:<id>_SALA_FT-0001.jpg) → AAAAMMDD_<SALA>_SALA_FT-NNNN.jpg; qualquer nome sai limpo
export const nomeFoto = n => nomeArq(String(n || '').replace(/_SALA:[^_]*_SALA_/, '_SALA_'));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2200); }

// ---------- navegação (ciclo 7): o "voltar" do Android fecha a camada de cima ----------
// Cada camada aberta (painel da sala, sala limpa, ficha, Lista/Resumo/Equipamentos, vista do equipamento) vale um passo no
// histórico do navegador. Abaixo delas há um passo de guarda: ao chegar na raiz, o app pergunta "Sair do app?".
// A guarda só é criada depois do primeiro toque (o Chrome ignora, no botão voltar, passos criados sem toque).
const NAV = { pilha: [], guarda: false, pend: 0 };
const passo = d => { try { history.pushState({ appcampo: 1, d }, ''); } catch { /* sem histórico (arquivo local): vale só a pilha */ } };
function garantirGuarda() {
  if (NAV.guarda) return; NAV.guarda = true;
  const d = $('#sair'); if (d) d.remove();
  if (!(history.state && history.state.appcampo)) passo(0);
}
function recuar(n) { if (n > 0) { NAV.pend++; try { history.go(-n); } catch { NAV.pend--; } } }
function fecharAte(d) { while (NAV.pilha.length > d) NAV.pilha.pop().fechar(); }
function empilhar(tipo, fechar) { garantirGuarda(); NAV.pilha.push({ tipo, fechar }); passo(NAV.pilha.length); }
// fechar pela tela (✕, Cancelar, Salvar, ← Voltar): fecha já a camada (e as de cima) e recua o histórico
function desempilhar(tipo) {
  const i = NAV.pilha.map(c => c.tipo).lastIndexOf(tipo); if (i < 0) return false;
  const n = NAV.pilha.length - i; fecharAte(i); recuar(n); return true;
}
// troca a pilha inteira (ex.: "Ir para a sala" a partir da vista do equipamento)
function substituir(novas) {
  const n = NAV.pilha.length; fecharAte(0); garantirGuarda(); NAV.pilha = novas; const m = novas.length;
  if (m < n) recuar(n - m); else for (let d = n + 1; d <= m; d++) passo(d);
}
function perguntarSair() {
  if ($('#sair')) return;
  document.body.append(h('div', { id: 'sair', onclick: ev => { if (ev.target.id !== 'btnSairSim') garantirGuarda(); } }, h('div', { class: 'mbox' }, h('h2', {}, 'Sair do app?'),
    h('p', {}, 'Nada se perde: o que foi registrado fica guardado neste aparelho. Para sair, aperte "voltar" mais uma vez.'),
    h('div', { class: 'acts' }, h('button', { id: 'btnSairSim', onclick: () => { try { window.close(); } catch { /* o navegador não deixa fechar */ } history.back(); } }, 'Sair'),
      h('button', { class: 'primary', id: 'btnSairNao' }, 'Continuar no app')))));
}
window.addEventListener('popstate', ev => {
  const st = ev.state, meu = NAV.pend > 0; if (meu) NAV.pend--;
  if (!(st && st.appcampo)) { if (meu) return; fecharAte(0); NAV.guarda = false; perguntarSair(); return; }  // chegou na raiz
  if (!meu) fecharAte(st.d);
  if (st.d !== NAV.pilha.length) { try { history.replaceState({ appcampo: 1, d: NAV.pilha.length }, ''); } catch { /* idem */ } }
});
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, garantirGuarda, { capture: true, once: true });

// ---------- sala atual e vistoria automática (ciclo 7) ----------
// O app não sabe onde o conferente está; deduz pela sala em que ele mexe. "Sala atual" = a última sala cujo painel foi aberto,
// até abrir outra, ficar mais de 2 min na planta sem painel, ou fechar o dia. A janela de vistoria da sala vai da 1ª à última
// ação feita nela (conferir, etapa, foto, nota, item novo); só olhar não abre janela. Tudo vai em vistorias.json (casar fotos).
const DOIS_MIN = 120e3;
const codSala = s => !s ? '' : s.tipo === 'sala' || s.tipo === 'externa' || !s.tipo ? (s.codigo && s.codigo !== '?' ? s.codigo : s.id) : (s.id === '__SL__' ? s.codigo : (s.nome || s.codigo || s.id));
// modo inspeção (ciclo 8): chave no topo, lembrada no aparelho. Ligado, abrir o painel de uma sala já inicia a janela da sala
// (tipo "inspecao") e mostra a tela de abertura para o fotógrafo; desligado, vale a regra do ciclo 7 (só ação conta).
function inspLigada(v) {
  if (v === undefined) { if (S.insp === undefined) { try { S.insp = localStorage.getItem('appcampo.insp') === '1'; } catch { S.insp = false; } } return S.insp; }
  S.insp = !!v; try { localStorage.setItem('appcampo.insp', v ? '1' : '0'); } catch { /* sem armazenamento: vale só nesta sessão */ }
}
async function proxSeq(chave) { const n = ((await DB.get('meta', chave)) || 0) + 1; await DB.put('meta', n, chave); return n; }
const idAtual = () => (S.meta.vistoria && S.meta.vistoria.abriu ? S.meta.vistoria.sala : null);
async function entrouSala(s) {
  const v = S.meta.vistoria, agora = Date.now(), insp = inspLigada();
  if (v && v.sala === s.id && !!v.insp === insp) { if (v.fora) { v.fora = null; await DB.put('meta', v, 'vistoria'); } return; }
  if (v) await encerrarVistoria(agora);
  S.meta.vistoria = { sala: s.id, rot: codSala(s), abriu: agora, ini: insp ? agora : null, ult: null, n: 0, fora: null };
  if (insp) Object.assign(S.meta.vistoria, { insp: 1, seq: await proxSeq('inspSeq'), telas: [] });
  await DB.put('meta', S.meta.vistoria, 'vistoria');
  if (insp && S.painel && S.painel.id === s.id) telaAbertura(s);  // só aqui: a janela acabou de abrir. Com a janela já aberta, só "Mostrar de novo"
  S.meta.recentes = [s.id, ...(S.meta.recentes || []).filter(x => x !== s.id)].slice(0, 8); await DB.put('meta', S.meta.recentes, 'recentes');
  renderStatus();
}
async function encerrarVistoria(saiu = Date.now()) {
  const v = S.meta.vistoria; if (!v) return;
  S.meta.vistoria = null; await DB.put('meta', null, 'vistoria');
  // com ações: evento "fim" no horário da última ação (janela = ini → fim); sem ações: só a visita.
  // Inspeção: a janela vai da abertura do painel até a saída da sala, com ou sem ação.
  const t = v.insp ? saiu : (v.ult || saiu);
  await DB.put('eventos', { ts: t, tipo: 'vistoria', id: v.sala, campo: v.ini ? 'fim' : 'visita', valor: new Date(t).toISOString(), sala: v.sala, rot: v.rot,
    ini: v.ini, fim: v.insp ? saiu : v.ult, abriu: v.abriu, saiu, n: v.n, auto: 1, exportado: 0,
    ...(v.insp ? { modo: 'inspecao', ordem: v.seq, telas: v.telas || [] } : {}) });  // "seq" é a chave do registro de eventos: não usar
  renderStatus();
}
function acaoNaSala(ts) {
  const v = S.meta.vistoria; if (!v || !v.abriu) return;
  v.ini = v.ini || ts; v.ult = ts; v.n = (v.n || 0) + 1; return DB.put('meta', v, 'vistoria');
}
// a cada 15 s: atualiza o indicador e encerra a sala atual depois de 2 min na planta sem painel aberto
async function alternarInspecao() {
  inspLigada(!inspLigada());
  await encerrarVistoria();  // a janela aberta fecha com a regra com que foi aberta; a sala em tela reabre com a regra nova
  renderTopo(); if (S.painel) { await entrouSala(S.painel); renderPainel(); }
  toast(inspLigada() ? 'Modo inspeção ligado: abrir a sala já inicia a janela e mostra a tela para o fotógrafo' : 'Modo inspeção desligado');
}
function renderTopo() {
  const on = inspLigada(), b = $('#btnInsp'); document.body.classList.toggle('insp', on);
  if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '🔎 Inspeção: ligada' : 'Inspeção'; b.onclick = () => { if (S.seed) alternarInspecao(); }; }
  const m = $('#btnMenu'); if (m) m.onclick = () => { if (S.seed) abrirMenu(); };
}
function abrirMenu() {
  const s = S.painel, v = S.meta.vistoria;
  modal(h('div', { class: 'ficha', id: 'menu' }, h('h2', {}, 'Menu'),
    h('div', { class: 'menu-ops' },
      h('button', { id: 'mnCalibrar', onclick: () => { fecharModal(); setTimeout(telaCalibrar, 150); } }, '🕒 Calibrar relógio (fotógrafo)'),
      h('button', { id: 'mnInsp', onclick: () => { fecharModal(); alternarInspecao(); } }, inspLigada() ? '🔎 Desligar o modo inspeção' : '🔎 Ligar o modo inspeção'),
      s && v && v.insp && v.sala === s.id ? h('button', { id: 'mnAbertura', onclick: () => { fecharModal(); setTimeout(() => telaAbertura(s), 150); } }, `📺 Tela de abertura de ${codSala(s)}`) : null),
    h('p', { class: 'sub' }, 'Calibrar relógio: o fotógrafo fotografa essa tela no início do dia; a foto dá o desvio do relógio da câmera.'),
    h('div', { class: 'acts' }, h('button', { type: 'button', onclick: fecharModal }, 'Fechar'))));
}
// ---------- tela de abertura da sala e calibração do relógio (ciclo 8) ----------
// O relógio da câmera do fotógrafo quase nunca bate com o do celular. Ao entrar numa sala (modo inspeção), o app mostra em tela
// cheia o código da sala, a hora com segundos e um QR "sala|data-hora ISO|nº"; o fotógrafo fotografa a tela e, no escritório,
// essa foto abre a sala para as fotos seguintes dele. O QR só leva o identificador da sala, a hora e o nº (nada de projeto).
const p2 = n => String(n).padStart(2, '0');
export const isoLocal = ts => { const d = new Date(ts), o = -d.getTimezoneOffset(), a = Math.abs(o);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}${o >= 0 ? '+' : '-'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`; };
const horaSeg = ts => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
function telaCheia(conteudo, aoTique) {
  if ($('#abertura')) desempilhar('abertura');
  const el = h('div', { id: 'abertura', role: 'dialog', onclick: () => { if (!desempilhar('abertura')) fim(); } }, conteudo);
  const iv = setInterval(() => aoTique(el), 250);
  const fim = () => { clearInterval(iv); el.remove(); };
  document.body.append(el); aoTique(el); empilhar('abertura', fim);
}
async function telaAbertura(s) {
  const v = S.meta.vistoria; if (!v || v.sala !== s.id || !v.insp) return;
  const ts = Date.now(), cod = codSala(s), txt = `${s.id}|${isoLocal(ts)}|${v.seq}`;
  v.telas = [...(v.telas || []), ts]; await DB.put('meta', v, 'vistoria');
  telaCheia(h('div', { class: 'ab-box', 'data-qr': txt },
    h('div', { class: 'ab-rot' }, 'SALA'),
    h('div', { class: 'ab-cod', id: 'abCod', style: `font-size:min(${Math.round(130 / Math.max(6, cod.length))}vw,17vh)` }, cod),
    h('div', { class: 'ab-nome' }, s.nome && s.nome !== cod ? s.nome : ''),
    h('div', { class: 'ab-data' }, new Date(ts).toLocaleDateString('pt-BR'), h('b', { id: 'abHora' }, horaSeg(ts))),
    h('div', { class: 'ab-qr', id: 'abQr', html: qrSvg(txt) }),
    h('div', { class: 'ab-pe' }, `nº ${v.seq} · fotografe esta tela ao entrar na sala · toque para fechar`)),
    el => { const hr = el.querySelector('#abHora'); if (hr) hr.textContent = horaSeg(Date.now()); });
}
async function telaCalibrar() {
  const n = await proxSeq('calSeq'); let ult = '';
  await log('sistema', null, 'calibração do relógio', isoLocal(Date.now()));
  telaCheia(h('div', { class: 'ab-box cal' },
    h('div', { class: 'ab-rot' }, 'CALIBRAR RELÓGIO'),
    h('div', { class: 'ab-cod', id: 'abHora' }, ''),
    h('div', { class: 'ab-data', id: 'abDia' }, ''),
    h('div', { class: 'ab-qr', id: 'abQr' }),
    h('div', { class: 'ab-pe' }, 'fotografe esta tela com a câmera, no início do dia · toque para fechar')),
    el => {  // o QR acompanha o relógio, segundo a segundo: a foto dá o desvio do relógio da câmera
      const agora = Date.now(), iso = isoLocal(agora); if (iso === ult) return; ult = iso;
      el.querySelector('#abHora').textContent = horaSeg(agora); el.querySelector('#abDia').textContent = new Date(agora).toLocaleDateString('pt-BR');
      const q = el.querySelector('#abQr'); q.innerHTML = qrSvg(`CAL|${iso}|${n}`); q.dataset.qr = `CAL|${iso}|${n}`;
    });
}
async function tique() {
  const v = S.meta.vistoria; if (!v || !v.abriu) return;
  const naPlanta = S.view === 'planta' && !S.painel && !S.eqSel && !$('#modal').classList.contains('on') && !$('#abertura') && !$('#camera');
  if (!naPlanta) { if (v.fora) { v.fora = null; await DB.put('meta', v, 'vistoria'); } }
  else if (!v.fora) { v.fora = Date.now(); await DB.put('meta', v, 'vistoria'); }
  else if (Date.now() - v.fora > DOIS_MIN) await encerrarVistoria(v.fora);
  renderStatus();
}
// vistoria manual (até a v1.3.x) que ficou aberta: fecha no horário do último evento de item daquela passada
// (os eventos seguidos, sem intervalo maior que 30 min, a partir do início)
async function migrarVistoriaManual() {
  const v = S.meta.vistoria; if (!v || v.abriu) return;
  const ts = (await DB.all('eventos')).filter(e => ['item', 'lote', 'foto'].includes(e.tipo) && e.ts >= (v.ini || 0)).map(e => e.ts).sort((a, b) => a - b);
  let fim = v.ini || Date.now(); for (const t of ts) { if (t - fim > 30 * 60e3) break; fim = t; }
  await DB.put('eventos', { ts: fim, tipo: 'vistoria', id: v.sala, campo: 'fim', valor: new Date(fim).toISOString(), sala: v.sala, ini: v.ini, fim,
    migrado: 'vistoria manual sem fim: fechada no último evento', exportado: 0 });
  S.meta.vistoria = null; await DB.put('meta', null, 'vistoria');
}

// ---------- estado ----------
const novoEstado = id => ({ id, c: [0, 0, 0, 0, 0], enc: '', estado: '', onde: '', com: '', fotos: [], fora: '', fora_obs: '', diverg: '', diverg_obs: '', ts: 0 });
const est = id => S.estado.get(id) || novoEstado(id);
// fora do escopo (motivo documentado) e divergência (não encontrado / não está no site, com comentário e foto):
// os dois saem da planta e das pendências; ficam na lista, no histórico e no pacote, cada um contado à parte
const foraEsc = it => !!est(it.id).fora;
const divEsc = it => !!est(it.id).diverg;
const ativos = lista => lista.filter(it => !foraEsc(it) && !divEsc(it));
const prevista = it => /prevista/.test(it.pos_fonte || '');
function proxima(it) {
  const e = est(it.id).c;
  if (!e[0]) return 0; if (!e[1]) return 1; if (it.elev && !e[2]) return 2; if (!e[3]) return 3; if (!e[4]) return 4; return 5;
}
function progresso(lista) { // fração de etapas aplicáveis feitas (sem os itens fora do escopo)
  let tot = 0, ok = 0;
  for (const it of ativos(lista)) { const c = est(it.id).c; for (let k = 0; k < 5; k++) { if (k === 2 && !it.elev) continue; tot++; if (c[k]) ok++; } }
  return tot ? ok / tot : 0;
}
const conferidos = lista => ativos(lista).filter(it => est(it.id).c[0]).length;
const pendEtapa = (lista, k) => ativos(lista).filter(i => proxima(i) === k).length;

async function log(tipo, id, campo, valor, extra = {}) {
  const ts = Date.now();
  await DB.put('eventos', { ts, tipo, id, campo, valor, exportado: 0, ...extra });
  if (tipo === 'item' || tipo === 'lote' || tipo === 'foto') await acaoNaSala(ts);
  if (!S.meta.pendentes) { S.meta.pendDesde = Date.now(); await DB.put('meta', S.meta.pendDesde, 'pendDesde'); }
  S.meta.pendentes = (S.meta.pendentes || 0) + 1; await DB.put('meta', S.meta.pendentes, 'pendentes');
  renderStatus();
}
async function setEstado(id, patch, campo, valor) {
  const e = { ...est(id), ...patch, ts: Date.now() };
  S.estado.set(id, e); await DB.put('estado', e);
  await log('item', id, campo, valor);
}
async function toggleEtapa(it, k) {
  if (k === 2 && !it.elev) return;
  const c = [...est(it.id).c]; c[k] = c[k] ? 0 : 1;
  await setEstado(it.id, { c }, ETAPAS[k], c[k]);
}

// ---------- carga ----------
async function carregar() {
  const seed = await DB.get('meta', 'seed');
  if (!seed) return false;
  // pacote de dados antigo (v1.1) sem a ligação sala limpa → L2: a sala limpa passa a abrir pelo L2
  if (seed.plantas.SL && !seed.plantas.SL.pai && seed.plantas.L2) seed.plantas.SL.pai = 'L2';
  S.seed = seed;
  const novos = await DB.all('novos');
  S.itens = [...seed.itens, ...novos];
  S.byId = new Map(S.itens.map(i => [i.id, i]));
  S.estado = new Map((await DB.all('estado')).map(e => [e.id, e]));
  S.salasEd = await DB.all('salas');
  for (const k of ['pendentes', 'ultimoFechamento', 'ftSeq', 'novoSeq', 'conferente', 'vistoria', 'pendDesde', 'recentes']) S.meta[k] = await DB.get('meta', k);
  // nome da sala no Schedule (ex.: DOCA) ↔ sala da planta: "Onde está agora" pode guardar um ou outro
  S.alias = {}; S.aliasInv = {};
  for (const i of seed.itens) if (i.local && i.sala && i.sala !== i.local) { S.alias[i.sala] = i.local; S.aliasInv[i.local] = i.sala; }
  await migrarDivergencias(); await migrarVistoriaManual(); await indexarFotosSala();
  for (const nv of Object.keys(seed.plantas)) {
    const blob = await DB.get('arquivos', 'planta_' + nv);
    if (S.plantaUrls[nv]) URL.revokeObjectURL(S.plantaUrls[nv]);
    S.plantaUrls[nv] = blob ? URL.createObjectURL(blob) : seed.plantas[nv].img;
    const alt = seed.plantas[nv].img_sem_eq;
    if (alt) {
      const b2 = await DB.get('arquivos', 'planta_' + nv + '~sem');
      if (S.plantaUrls[nv + '~sem']) URL.revokeObjectURL(S.plantaUrls[nv + '~sem']);
      S.plantaUrls[nv + '~sem'] = b2 ? URL.createObjectURL(b2) : alt;
    }
  }
  return true;
}
// ciclo 8: cada foto de sala é um registro (sala, hora, origem, comentário, equipamento, ponto na planta). As fotos de
// "Notas / inspeção" de versões anteriores viram registros, sem perder nada. O índice em memória guarda só os metadados.
async function indexarFotosSala() {
  S.fotosSala = new Map();
  for (const f of await DB.all('fotos')) {
    if (!String(f.item || '').startsWith('SALA:')) continue;
    if (!f.reg) { Object.assign(f, { sala_id: f.item.slice(5), origem: 'app', com: f.com || '', equip: f.equip || '', ponto: f.ponto || null, reg: 1, migrado: 'Notas / inspeção' }); await DB.put('fotos', f); }
    const { blob, ...m } = f; if (!S.fotosSala.has(f.sala_id)) S.fotosSala.set(f.sala_id, []); S.fotosSala.get(f.sala_id).push(m);
  }
  for (const l of S.fotosSala.values()) l.sort((a, b) => a.ts - b.ts);
}
const fotosDaSala = s => S.fotosSala.get(s.id) || [];
// ciclo 6b: "não está no site / não encontrado" deixou de ser "fora do escopo" e passou a ser divergência
async function migrarDivergencias() {
  const md = new Set(ESC().motivos_diverg.concat(['Não está no site', 'Não encontrado']));
  for (const e of S.estado.values()) {
    if (e.fora && md.has(e.fora)) {
      const n = { ...e, diverg: e.fora, diverg_obs: e.fora_obs || '', fora: '', fora_obs: '', ts: Date.now(), migrado: 'fora→divergência' };
      S.estado.set(e.id, n); await DB.put('estado', n);
      await log('item', e.id, 'divergência (migrado de fora do escopo)', `${n.diverg}${n.diverg_obs ? ' – ' + n.diverg_obs : ''}`);
    }
  }
}
async function importarSeed(seed, imagens = {}) {
  if (!seed || !Array.isArray(seed.itens) || !seed.plantas) throw new Error('Pacote de dados inválido');
  // demonstração e controle não se misturam: o que foi registrado com um tipo de pacote não passa para o outro
  if (S.seed && !!S.seed.demo !== !!seed.demo && ((await DB.all('estado')).length || (await DB.all('novos')).length || (await DB.all('fotos')).length))
    throw new Error(S.seed.demo ? 'Este aparelho tem registros de DEMONSTRAÇÃO. Para carregar o pacote oficial, use antes "Zerar dados deste aparelho" (Resumo).'
      : 'Este aparelho tem registros do controle. Um pacote de DEMONSTRAÇÃO só entra num aparelho zerado ("Zerar dados deste aparelho", no Resumo, depois de fechar o dia).');
  await DB.put('meta', seed, 'seed');
  for (const [nv, blob] of Object.entries(imagens)) await DB.put('arquivos', blob, 'planta_' + nv);
  await log('sistema', null, 'seed', seed.versao);
}
async function importarArquivo(file) {
  if (file.name.toLowerCase().endsWith('.json')) {
    await importarSeed(JSON.parse(await file.text()));
  } else {
    const z = await readZip(file);
    if (!z['seed.json']) throw new Error('O ZIP não tem seed.json');
    const seed = JSON.parse(new TextDecoder().decode(z['seed.json']));
    const imgs = {};
    for (const nv of Object.keys(seed.plantas)) {
      const k = Object.keys(z).find(n => n.endsWith(`plantas/${nv}.jpg`)); if (k) imgs[nv] = new Blob([z[k]], { type: 'image/jpeg' });
      const alt = seed.plantas[nv].img_sem_eq; const k2 = alt && Object.keys(z).find(n => n.endsWith(alt));
      if (k2) imgs[nv + '~sem'] = new Blob([z[k2]], { type: 'image/jpeg' });
    }
    await importarSeed(seed, imgs);
  }
}

// ---------- telas ----------
function renderStatus() {
  const p = S.meta.pendentes || 0, u = S.meta.ultimoFechamento;
  const el = $('#status'); if (!el) return;
  const velho = !u || (Date.now() - u) > 24 * 3600e3;
  el.innerHTML = '';
  el.append(...[S.seed ? h('span', { class: 'pill dados', id: 'pillDados', title: 'Versão do pacote de dados' }, `dados ${S.seed.versao}`) : null,
            h('span', { class: 'pill' + (p ? ' warn' : ''), id: 'pillPend' }, `${p} alteração(ões) a fechar`),
            h('span', { class: 'pill hide-sm' + (velho && p ? ' bad' : '') }, u ? `Último fechamento ${fmtD(u)}` : 'Nunca fechado'),
            idAtual() ? h('span', { class: 'pill vist', id: 'pillSala', title: 'Sala em que o app considera que você está' },
              `📷 ${S.meta.vistoria.rot || S.meta.vistoria.sala} · ${Math.max(0, Math.round((Date.now() - S.meta.vistoria.abriu) / 60e3))} min`) : null].filter(Boolean));
  renderTopo();
  const fx = $('#faixaDemo'); if (fx) fx.hidden = !(S.seed && S.seed.demo); document.body.classList.toggle('demo', !!(S.seed && S.seed.demo));
}
// Lista, Resumo e Equipamentos são uma camada sobre a planta: o voltar retorna à planta, com o zoom de antes
function nav(view) {
  if (view === 'planta') { substituir([]); S.view = 'planta'; render(); return; }
  substituir([{ tipo: 'view', fechar: () => { S.view = 'planta'; render(); } }]);
  S.view = view; render();
}
function render() {
  const aba = S.view === 'planta' ? ((S.seed && S.seed.plantas[S.planta] && S.seed.plantas[S.planta].pai) || S.planta) : S.view;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === aba));
  const main = $('#main'); const rol = S._viewAnt === S.view ? main.scrollTop : 0; S._viewAnt = S.view;  // mesma tela: mesma rolagem
  main.innerHTML = '';
  if (S.view === 'planta') main.append(telaPlanta());
  else if (S.view === 'lista') { S._rol = rol; main.append(telaLista()); }
  else if (S.view === 'equip') main.append(telaEquip());
  else if (S.view === 'resumo') main.append(telaResumo());
  main.scrollTop = rol;
  renderStatus();
}
// depois de uma ação: atualiza o que estiver aberto (vista do equipamento, painel da sala ou a tela)
function refrescar() { if (S.eqSel) renderVista(); if (S.painel) renderPainel(); else render(); }

// salas = base do pacote de dados + edições feitas no aparelho (store "salas")
function salasDe(pl) {
  const base = (S.seed.plantas[pl] && S.seed.plantas[pl].salas) || [];
  const ed = S.salasEd.filter(s => s.planta === pl);
  const m = new Map(base.map(s => [s.id, { ...s, planta: pl }]));
  for (const e of ed) {
    if (e.excluida) { m.delete(e.id); continue; }
    const b = m.get(e.id) || {};
    // edição feita antes de um pacote com contornos simplificados, sem mexer na forma (só código, nome, revisada):
    // ela guardou o contorno antigo – vale o contorno novo do pacote. Quem mexeu na forma continua com a sua.
    if (!e.poly && !b.poly) continue;  // edição só de código/nome de uma sala que o pacote novo não tem mais: sem contorno, não entra
    const velho = e.poly && b.poly_antes && mesmoPoly(e.poly, b.poly_antes);
    m.set(e.id, { ...b, ...e, ...(velho ? { poly: b.poly, label: b.label } : {}) });
  }
  return [...m.values()].filter(s => !s.dentro); // salas cobertas por um bloco (ex.: dentro da sala limpa) ficam no detalhe
}
function mesmoPoly(a, b) { return !!a && !!b && a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]); }
function todasSalas() { return Object.keys(S.seed.plantas).flatMap(pl => salasDe(pl)); }
function salaPorId(id) { return todasSalas().find(s => s.id === id); }
function pip(pt, poly) {
  let d = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) d = !d;
  }
  return d;
}
// sala oficial sob uma marcação de uso (buffer, crating, célula...): pela posição, vale também para marcações feitas no aparelho
function salaSob(m) {
  if (!m || m.tipo !== 'marca' || !m.poly || !m.poly.length) return null;
  const c = [m.poly.reduce((a, p) => a + p[0], 0) / m.poly.length, m.poly.reduce((a, p) => a + p[1], 0) / m.poly.length];
  const base = salasDe(m.planta || S.planta).concat(((S.seed.plantas[m.planta] || {}).salas || []).filter(x => x.dentro));
  return base.find(x => x.tipo === 'sala' && x.poly && pip(c, x.poly)) || base.find(x => x.tipo === 'area' && x.poly && pip(c, x.poly))
    || base.find(x => x.tipo === 'externa' && x.poly && pip(c, x.poly)) || null;
}
function nomeOficial(o) { return [o.codigo && o.codigo !== '?' && o.codigo !== o.nome ? o.codigo : '', o.nome].filter(Boolean).join(' '); }
function rotuloSala(s) {
  if (!s) return '';
  if (s.tipo === 'marca') { const uso = s.nome || s.codigo; const o = salaSob(s); return o && nomeOficial(o) ? `${uso} · ${nomeOficial(o)}` : uso; }
  return `${s.codigo && s.codigo !== '?' ? s.codigo : s.id}${s.nome && s.nome !== s.codigo ? ' · ' + s.nome : ''}`;
}
// todos os itens de uma planta-detalhe (a sala limpa): os da sala de origem dela, os criados nela e os movidos para uma área dela
function itensDaPlanta(pl) {
  const p = S.seed.plantas[pl] || {}; const ids = new Set(salasDe(pl).map(x => x.id));
  const orig = p.sala_itens || 'SALA LIMPA';
  return S.itens.filter(i => i.sala === orig || i.planta_novo === pl || ids.has(est(i.id).onde));
}
function itensDaSala(s) {
  if (!s) return [];
  if (s.tipo === 'bloco') return itensDaPlanta(s.abre);
  if (s.id === '__SL__') return itensDaPlanta('SL');
  if (s.planta === 'SL' && s.tipo === 'area') return S.itens.filter(i => i.area === s.id || est(i.id).onde === s.id);
  if (s.planta === 'SL' && s.tipo === 'marca') return S.itens.filter(i => i.sub === s.id || est(i.id).onde === s.id);
  const ids = new Set([s.id, ...(s.juntou || [])]);
  return S.itens.filter(i => ids.has(i.local) || ids.has(est(i.id).onde));
}
function cor(p) { return p >= 0.999 ? '#2e7d32' : p > 0 ? '#e0a100' : '#7a8597'; }
const COR_MARCA = { ocupado: '#7b3fa0', ideia: '#1f7a8c', estacao: '#c55a11', buffer: '#2e7d32', bloqueado: '#c62828', porta: '#0d47a1' };
const area2 = poly => Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
function noPoligono(x, y, poly) {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) dentro = !dentro;
  }
  return dentro;
}

function telaPlanta() {
  const pl = S.seed.plantas[S.planta];
  const salas = salasDe(S.planta);
  const wrap = h('div', { class: 'mapwrap' + (S.edit ? ' editando' : ''), id: 'mapwrap' });
  const layer = h('div', { class: 'layer' + (pl.pai ? ' detalhe' : ''), id: 'layer', style: `width:${pl.w}px;height:${pl.h}px` },
    h('img', { id: 'imgPlanta', src: (semEq() && pl.img_sem_eq && S.plantaUrls[S.planta + '~sem']) || S.plantaUrls[S.planta], width: pl.w, height: pl.h, alt: pl.nome, draggable: 'false' }));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${pl.w} ${pl.h}`); svg.setAttribute('width', pl.w); svg.setAttribute('height', pl.h); svg.classList.add('salas');
  const ordem = { externa: -1, bloco: 0, area: 0, sala: 1, marca: 2 };  // áreas externas (ciclo 8) por baixo de tudo
  svg.innerHTML = '<defs><pattern id="hachuraExt" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="26" stroke="#00796b" stroke-width="5" stroke-opacity=".28"/></pattern></defs>';
  for (const s of [...salas].sort((a, b) => ordem[a.tipo] - ordem[b.tipo])) {
    const its = ativos(itensDaSala(s)); const cf = conferidos(its);
    const pr = S.modoCor === 'mov' ? progresso(its) : (its.length ? cf / its.length : 0);
    const pg = document.createElementNS(NS, 'polygon');
    pg.setAttribute('points', s.poly.map(p => p.join(',')).join(' '));
    pg.dataset.sala = s.id; pg.dataset.n = its.length;
    pg.classList.add('sl', 'sl-' + s.tipo); if (its.length) pg.classList.add('tem'); if (S.painel && S.painel.id === s.id) pg.classList.add('sel');
    pg.style.setProperty('--c', s.tipo === 'marca' ? (COR_MARCA[s.marca] || '#555') : cor(pr));
    svg.append(pg);
    const lx = s.label ? s.label[0] : s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length;
    const ly = s.label ? s.label[1] : s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length;
    if (its.length || s.tipo !== 'sala') {
      layer.append(h('span', { class: 'dot dot-' + s.tipo, style: `left:${lx}px;top:${ly}px;--c:${cor(pr)}`, 'data-dot': s.id }));
      const tit = s.tipo === 'sala' ? (s.codigo !== '?' ? s.codigo : s.id) : s.tipo === 'bloco' ? `${s.codigo} ▸` : s.tipo === 'externa' ? s.codigo : s.nome;
      layer.append(h('button', { class: `pin pin-${s.tipo}`, style: `left:${lx}px;top:${ly}px;--c:${s.tipo === 'marca' ? (COR_MARCA[s.marca] || '#555') : cor(pr)}`,
        'data-pin': s.tipo === 'sala' && s.codigo !== '?' ? s.codigo : s.id, 'data-sala': s.id, onclick: ev => { ev.stopPropagation(); tocarSala(s); } },
        h('b', {}, tit), its.length ? h('small', {}, `${cf}/${its.length}`) : null));
    } else if (s.codigo && s.codigo !== '?') {
      layer.append(h('span', { class: 'lbl', style: `left:${lx}px;top:${ly}px` }, s.codigo.replace(/^L\d\.P\./, '')));
    }
  }
  if (S.draw) {
    const pl2 = document.createElementNS(NS, 'polyline');
    pl2.setAttribute('points', S.draw.map(p => p.join(',')).join(' ')); pl2.classList.add('desenho'); svg.append(pl2);
    for (const p of S.draw) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('r', 10); c.classList.add('vert'); svg.append(c); }
  }
  layer.insertBefore(svg, layer.children[1]);
  wrap.append(layer);
  const ctr = h('div', { class: 'zoomctl' },
    h('button', { onclick: () => zoomBy(1.4), 'aria-label': 'Aproximar' }, '+'),
    h('button', { onclick: () => zoomBy(1 / 1.4), 'aria-label': 'Afastar' }, '−'),
    h('button', { onclick: () => fit(), 'aria-label': 'Ajustar' }, '⤢'));
  const barra = S.draw
    ? h('div', { class: 'editbar' }, h('b', {}, `Nova sala: toque nos cantos (${S.draw.length} ponto(s))`),
        h('button', { id: 'btnDesfazer', onclick: () => { S.draw.pop(); render(); } }, 'Desfazer'),
        h('button', { class: 'primary', id: 'btnConcluir', disabled: S.draw.length < 3, onclick: () => salvarSalaNova() }, 'Concluir'),
        btnEncaixe(), h('button', { onclick: () => { S.draw = null; render(); } }, 'Cancelar'))
    : S.edit ? barraEdicao() : null;
  const filhas = Object.entries(S.seed.plantas).filter(([, p]) => p.pai === S.planta);
  const leg = h('div', { class: 'legend' }, h('b', {}, pl.nome), h('span', { class: 'hide-sm' }, ` · ${pl.fonte} ·`), ' cor por ',
    h('button', { class: 'chip sm' + (S.modoCor !== 'mov' ? ' on' : ''), id: 'corConf', onclick: () => { S.modoCor = 'conf'; render(); } }, 'conferência'),
    h('button', { class: 'chip sm' + (S.modoCor === 'mov' ? ' on' : ''), id: 'corMov', onclick: () => { S.modoCor = 'mov'; render(); } }, 'move-out'),
    ...filhas.map(([k, p]) => h('button', { class: 'chip sm', 'data-entrar': k, onclick: () => entrarPlanta(k) }, `▸ ${p.titulo || 'Entrar: ' + k}`)),
    h('button', { class: 'chip sm' + (S.edit ? ' on' : ''), id: 'btnEditar', onclick: () => { S.edit = !S.edit; S.draw = null; render(); } }, '✏️ Editar salas'));
  // dentro de uma planta-detalhe (sala limpa): barra com voltar e "todos os itens"
  const sub = pl.pai ? h('div', { class: 'subbar' },
    h('button', { id: 'btnVoltar', class: 'primary', onclick: () => entrarPlanta(pl.pai) }, `← Voltar ao ${pl.pai}`),
    h('b', {}, pl.titulo || pl.nome),
    h('button', { class: 'chip sm', id: 'btnSLtodos', onclick: () => abrirSala({ id: '__SL__', planta: S.planta, tipo: 'area', codigo: pl.titulo || 'Sala limpa', nome: 'todos os itens' }) }, 'Todos os itens'),
    pl.img_sem_eq ? h('button', { class: 'chip sm' + (semEq() ? '' : ' on'), id: 'btnEquip', 'aria-pressed': String(!semEq()),
      onclick: () => { semEq(!semEq()); render(); } }, semEq() ? 'Equipamentos: desligados' : 'Equipamentos: ligados') : null) : null;
  if (S.edit) desenhoEdicao(svg, layer);
  const box = h('div', { class: 'planta' }, sub, barra, wrap, ctr, leg);
  requestAnimationFrame(() => { if (!S.zoom._nv || S.zoom._nv !== S.planta) fit(); else applyZoom(); bindPanZoom(wrap); });
  return box;
}
// "Equipamentos: ligar/desligar" (sala limpa): fundo só com paredes e áreas; lembrado no aparelho
function semEq(v) {
  if (v === undefined) { if (S.semEq === undefined) { try { S.semEq = localStorage.getItem('appcampo.semEq') === '1'; } catch { S.semEq = false; } } return S.semEq; }
  S.semEq = !!v; try { localStorage.setItem('appcampo.semEq', v ? '1' : '0'); } catch { /* sem armazenamento: vale só nesta sessão */ }
}
function applyZoom() {
  const l = $('#layer'); if (!l) return;
  l.style.transform = `translate(${S.zoom.x}px,${S.zoom.y}px) scale(${S.zoom.s})`;
  l.style.setProperty('--inv', 1 / S.zoom.s);
  l.classList.toggle('perto', S.zoom.s > (S.zoom.fit || 1) * 1.9);
  const mw = $('#mapwrap'); const emPe = mw && mw.clientHeight > mw.clientWidth * 1.15;  // celular em pé
  l.classList.toggle('longe', !!emPe && S.zoom.s < (S.zoom.fit || 1) * 1.6);
  declutter(l);
  if (S.edModo === 'vertices' && S.edTmp && S.edTmp.poly) atualizaVertices();
}
// afasta rótulos que se sobrepõem na tela (o ponto fica na posição real; uma linha liga ponto e rótulo)
function declutter(l) {
  const pins = [...l.querySelectorAll('.pin')];
  pins.forEach(p => { p.style.setProperty('--dy', '0px'); p.style.setProperty('--dx', '0px'); });
  const W = (l.parentElement || l).getBoundingClientRect();
  const rs = pins.map(p => ({ p, r: p.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
  const placed = [];
  for (const o of rs) {
    let dy = 0; let moved = true, guard = 0;
    // rótulo cortado na borda da tela: puxa para dentro (o ponto continua no lugar)
    let dx = o.r.left < W.left + 2 ? W.left + 2 - o.r.left : o.r.right > W.right - 2 ? W.right - 2 - o.r.right : 0;
    if (o.r.width > W.width - 4) dx = 0;
    const r = { left: o.r.left + dx, right: o.r.right + dx, top: o.r.top, bottom: o.r.bottom };
    o.p.style.setProperty('--dx', `${dx / S.zoom.s}px`);
    while (moved && guard++ < 40) {
      moved = false;
      for (const q of placed) {
        if (r.left < q.right + 4 && r.right > q.left - 4 && r.top + dy < q.bottom + 4 && r.bottom + dy > q.top - 4) { dy = q.bottom + 4 - r.top; moved = true; }
      }
    }
    placed.push({ left: r.left, right: r.right, top: r.top + dy, bottom: r.bottom + dy });
    o.p.style.setProperty('--dy', `${dy / S.zoom.s}px`);
    const dot = l.querySelector(`.dot[data-dot="${CSS.escape(o.p.dataset.sala)}"]`);
    if (dot) { dot.style.setProperty('--len', `${dy / S.zoom.s}px`); dot.classList.toggle('lead', dy > 0); }
  }
}
function fit() {
  const w = $('#mapwrap'), pl = S.seed.plantas[S.planta]; if (!w) return;
  let s = Math.min(w.clientWidth / pl.w, w.clientHeight / pl.h);
  const emPe = w.clientHeight > w.clientWidth * 1.15;
  if (pl.pai && emPe) s = w.clientWidth / pl.w;  // planta-detalhe no celular em pé: pela largura
  S.zoom = { s, fit: s, x: (w.clientWidth - pl.w * s) / 2, y: Math.max(0, (w.clientHeight - pl.h * s) / 2), _nv: S.planta }; applyZoom();
}
function zoomBy(f, cx, cy) {
  const w = $('#mapwrap'); if (!w) return;
  cx = cx ?? w.clientWidth / 2; cy = cy ?? w.clientHeight / 2;
  const s2 = Math.min(6, Math.max(0.05, S.zoom.s * f)); const k = s2 / S.zoom.s;
  S.zoom.x = cx - (cx - S.zoom.x) * k; S.zoom.y = cy - (cy - S.zoom.y) * k; S.zoom.s = s2; applyZoom();
}
function bindPanZoom(w) {
  const pts = new Map(); let last = null, down = null;
  w.onscroll = () => { if (w.scrollTop || w.scrollLeft) { w.scrollTop = 0; w.scrollLeft = 0; } };
  w.onpointerdown = e => {
    if (S.edModo === 'vertices' && S.edTmp && S.edTmp.poly) {
      const md = e.target.closest('.mid'), vt = e.target.closest('.vtx[data-i]');
      if (md) { e.preventDefault(); inserirVertice(+md.dataset.i); return; }
      if (vt) {  // arrastar o vértice; duplo clique ou toque longo apaga
        const i = +vt.dataset.i, agora = Date.now(); e.preventDefault(); clearTimeout(S.longo);
        if (S.ultVtx && S.ultVtx.i === i && agora - S.ultVtx.t < 400) { S.ultVtx = null; apagarVertice(i); return; }
        S.ultVtx = { i, t: agora }; S.drag = i; S.dragMov = 0;
        S.longo = setTimeout(() => { if (S.drag === i && S.dragMov < 8) { S.drag = null; S.ultVtx = null; apagarVertice(i); } }, 650);
        w.setPointerCapture(e.pointerId); return;
      }
      const r = w.getBoundingClientRect(), x = (e.clientX - r.left - S.zoom.x) / S.zoom.s, y = (e.clientY - r.top - S.zoom.y) / S.zoom.s;
      const ar = arestaSob(x, y);
      if (ar != null && !e.target.closest('.pin') && pts.size === 0) { iniciaAresta(ar, [x, y]); w.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    }
    if (e.target.closest('.pin')) return;
    w.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); last = null;
    down = pts.size === 1 ? { x: e.clientX, y: e.clientY, t: Date.now(), mov: 0 } : null;
  };
  w.onpointermove = e => {
    if (S.dragE && S.edTmp && S.edTmp.poly) {  // arrastando uma aresta inteira
      const r = w.getBoundingClientRect();
      moveAresta([(e.clientX - r.left - S.zoom.x) / S.zoom.s, (e.clientY - r.top - S.zoom.y) / S.zoom.s]); return;
    }
    if (S.drag != null && S.edTmp && S.edTmp.poly) {  // arrastando um vértice
      S.dragMov = (S.dragMov || 0) + Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      if (S.dragMov < 4) return;  // clique parado (1º do duplo clique, início do toque longo) não mexe no ponto
      const r = w.getBoundingClientRect();
      S.edTmp.poly[S.drag] = encaixar([(e.clientX - r.left - S.zoom.x) / S.zoom.s, (e.clientY - r.top - S.zoom.y) / S.zoom.s]);
      atualizaVertices(); return;
    }
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, e);
    if (down) down.mov += Math.abs(e.clientX - prev.clientX) + Math.abs(e.clientY - prev.clientY);
    if (pts.size === 1) { S.zoom.x += e.clientX - prev.clientX; S.zoom.y += e.clientY - prev.clientY; applyZoom(); }
    else if (pts.size === 2) {
      down = null;
      const [a, b] = [...pts.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const r = w.getBoundingClientRect();
      if (last) zoomBy(d / last, (a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top);
      last = d;
    }
  };
  const up = e => {
    if (S.drag != null || S.dragE) { S.drag = null; S.dragE = null; clearTimeout(S.longo); document.querySelectorAll('.aresta-sel').forEach(x => x.remove()); return; }
    const tap = down && pts.size === 1 && down.mov < 10 && Date.now() - down.t < 600;
    pts.delete(e.pointerId); if (pts.size < 2) last = null;
    if (tap && e.type === 'pointerup') {
      const r = w.getBoundingClientRect();
      const x = (e.clientX - r.left - S.zoom.x) / S.zoom.s, y = (e.clientY - r.top - S.zoom.y) / S.zoom.s;
      tocarPonto(x, y);
    }
    down = null;
  };
  w.onpointerup = up; w.onpointercancel = up;
  w.onwheel = e => { e.preventDefault(); const r = w.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); };
}
function tocarPonto(x, y) {
  if (S.draw) { S.draw.push(encaixar([x, y])); render(); return; }
  if (S.edit && S.edModo === 'dividir' && S.edTmp) {
    S.edTmp.pts.push(encaixar([x, y]));
    if (S.edTmp.pts.length === 2) dividir(S.edTmp.sala, S.edTmp.pts[0], S.edTmp.pts[1]); else render();
    return;
  }
  const pri = { marca: 0, sala: 1, bloco: 2, area: 2, externa: 3 };
  const cand = salasDe(S.planta).filter(s => noPoligono(x, y, s.poly))
    .sort((a, b) => pri[a.tipo] - pri[b.tipo] || area2(a.poly) - area2(b.poly));
  if (cand.length) tocarSala(cand[0]);
}
function tocarSala(s) {
  if (s.tipo === 'bloco') return entrarPlanta(s.abre);
  if (!S.edit) return abrirSala(s);
  if (S.edModo === 'juntar') {
    if (!S.edTmp) { S.edTmp = s; toast(`${rotuloSala(s)}: agora toque na sala vizinha`); render(); }
    else if (S.edTmp.id !== s.id) juntar(S.edTmp, s);
    return;
  }
  if (S.edModo === 'dividir') { if (!S.edTmp) { S.edTmp = { sala: s, pts: [] }; toast('Toque em 2 pontos para traçar a linha de corte'); render(); } return; }
  if (S.edModo === 'vertices') return;
  editarSala(s);
}
// "entrar na sala": troca para a planta-detalhe (ou volta à planta-mãe, com o zoom de antes)
function entrarPlanta(pl) {
  if (!S.seed.plantas[pl]) return;
  const de = S.planta;
  if (S.seed.plantas[de] && S.seed.plantas[de].pai === pl) { if (!desempilhar('planta')) trocaPlanta(pl); return; }  // ← Voltar
  if (S.painel) fecharPainel();
  trocaPlanta(pl);
  if (S.seed.plantas[pl].pai === de) empilhar('planta', () => trocaPlanta(de));  // o voltar do Android sai da sala limpa
}
function trocaPlanta(pl) {
  const de = S.planta;
  if (S.seed.plantas[pl].pai === de) S.zoomMae = { ...S.zoom };
  S.planta = pl; S.view = 'planta'; S.draw = null; S.painel = null; $('#painel').classList.remove('on');
  if (S.seed.plantas[de] && S.seed.plantas[de].pai === pl && S.zoomMae && S.zoomMae._nv === pl) { S.zoom = S.zoomMae; } else S.zoom._nv = null;
  render();
}

// ---------- edição de salas ----------
async function gravarSala(s, acao, semHist) {
  const i = S.salasEd.findIndex(x => x.id === s.id);
  if (!semHist) await historico([s.id]);
  s = { ...s, ts: Date.now() };
  if (i >= 0) S.salasEd[i] = s; else S.salasEd.push(s);
  await DB.put('salas', s);
  await log('sala', s.id, acao || (s.excluida ? 'excluida' : 'editada'), rotuloSala(s), { planta: s.planta });
}
// desfazer: guarda o registro de edição anterior de cada sala tocada (ou "não havia")
async function historico(ids) {
  const h_ = (await DB.get('meta', 'edHist')) || [];
  h_.push(ids.map(id => ({ id, antes: S.salasEd.find(x => x.id === id) || null })));
  while (h_.length > 40) h_.shift();
  await DB.put('meta', h_, 'edHist'); S.meta.edHist = h_.length;
}
async function desfazer() {
  const h_ = (await DB.get('meta', 'edHist')) || []; const ult = h_.pop(); if (!ult) return;
  for (const { id, antes } of ult) {
    const i = S.salasEd.findIndex(x => x.id === id);
    if (antes) { if (i >= 0) S.salasEd[i] = antes; else S.salasEd.push(antes); await DB.put('salas', antes); }
    else { if (i >= 0) S.salasEd.splice(i, 1); await DB.del('salas', id); }
  }
  await DB.put('meta', h_, 'edHist'); S.meta.edHist = h_.length;
  await log('sala', ult.map(x => x.id).join(','), 'desfeita', 'desfazer última edição', { planta: S.planta });
  S.edModo = null; S.edTmp = null; render(); toast('Última edição desfeita');
}
// encaixe na linha de parede do DWG mais próxima (vértice da parede tem preferência)
function encaixeLigado() { if (S.snap === undefined) { try { S.snap = localStorage.getItem('appcampo.snap') !== '0'; } catch { S.snap = true; } } return S.snap; }
function btnEncaixe() {
  return h('button', { class: 'chip sm' + (encaixeLigado() ? ' on' : ''), id: 'btnEncaixe', onclick: () => {
    S.snap = !encaixeLigado(); try { localStorage.setItem('appcampo.snap', S.snap ? '1' : '0'); } catch { /* só nesta sessão */ } render(); } },
    `🧲 Encaixe: ${encaixeLigado() ? 'ligado' : 'desligado'}`);
}
function encaixar([x, y]) {
  const pl = S.seed.plantas[S.planta]; const segs = pl.paredes || [];
  if (!encaixeLigado() || !segs.length) return [Math.round(x), Math.round(y)];
  const tol = 14 / (S.zoom.s || 1); let best = null, bd = tol * tol;
  for (const [x1, y1, x2, y2] of segs) {  // vértices primeiro
    for (const [px, py] of [[x1, y1], [x2, y2]]) { const d = (px - x) ** 2 + (py - y) ** 2; if (d < bd * 0.6) { bd = d / 0.6; best = [px, py]; } }
  }
  if (best) return best;
  bd = tol * tol;
  for (const [x1, y1, x2, y2] of segs) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy; if (!L) continue;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)); const px = x1 + t * dx, py = y1 + t * dy;
    const d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; best = [Math.round(px), Math.round(py)]; }
  }
  return best || [Math.round(x), Math.round(y)];
}
function revisadas(pl) { const ss = salasDe(pl).filter(x => x.tipo === 'sala'); return [ss.filter(x => x.revisada).length, ss.length]; }
function barraEdicao() {
  const [nr, nt] = revisadas(S.planta); const m = S.edModo;
  const msg = m === 'juntar' ? (S.edTmp ? `Juntar: toque na sala vizinha de ${rotuloSala(S.edTmp)}` : 'Juntar: toque na 1ª sala')
    : m === 'dividir' ? (S.edTmp ? `Dividir ${rotuloSala(S.edTmp.sala)}: toque em 2 pontos (${S.edTmp.pts.length}/2)` : 'Dividir: toque na sala')
    : m === 'vertices' ? `Forma de ${rotuloSala(S.edTmp.sala)} (${S.edTmp.poly.length} cantos): arraste a aresta (a vizinha acompanha) ou o canto · "+" insere canto · duplo clique / toque longo apaga`
    : 'Modo edição: toque numa sala para editar';
  return h('div', { class: 'editbar' }, h('b', { id: 'msgEdicao' }, msg),
    m === 'vertices'
      ? [h('button', { class: 'primary', id: 'btnSalvarForma', onclick: salvarForma }, 'Salvar forma'), h('button', { onclick: () => { S.edModo = null; S.edTmp = null; render(); } }, 'Cancelar')]
      : m ? h('button', { id: 'btnCancelarModo', onclick: () => { S.edModo = null; S.edTmp = null; render(); } }, 'Cancelar')
      : [h('button', { class: 'primary', id: 'btnNovaSala', onclick: () => { S.draw = []; render(); } }, '+ Nova sala'),
         h('button', { id: 'btnDividir', onclick: () => { S.edModo = 'dividir'; S.edTmp = null; render(); } }, '✂ Dividir'),
         h('button', { id: 'btnJuntar', onclick: () => { S.edModo = 'juntar'; S.edTmp = null; render(); } }, '⊕ Juntar')],
    h('button', { id: 'btnDesfazerEd', disabled: !S.meta.edHist, onclick: desfazer }, '↶ Desfazer'), btnEncaixe(),
    h('span', { class: 'pill', id: 'cntRev' }, `${S.planta}: ${nr}/${nt} revisadas`),
    h('button', { id: 'btnProxRev', onclick: proximaNaoRevisada }, '▸ Próxima não revisada'),
    h('button', { id: 'btnSairEdicao', onclick: () => { S.edit = false; S.edModo = null; S.edTmp = null; render(); } }, 'Sair da edição'));
}
function desenhoEdicao(svg, layer) {
  const NS = 'http://www.w3.org/2000/svg';
  if (S.edModo === 'juntar' && S.edTmp) { const pg = svg.querySelector(`polygon[data-sala="${CSS.escape(S.edTmp.id)}"]`); if (pg) pg.classList.add('sel'); }
  if (S.edModo === 'dividir' && S.edTmp) {
    const pg = svg.querySelector(`polygon[data-sala="${CSS.escape(S.edTmp.sala.id)}"]`); if (pg) pg.classList.add('sel');
    for (const [x, y] of S.edTmp.pts) layer.append(h('span', { class: 'vtx fixo', style: `left:${x}px;top:${y}px` }));
  }
  if (S.edModo === 'vertices' && S.edTmp) {
    const pg = document.createElementNS(NS, 'polygon'); pg.id = 'polyEd'; pg.classList.add('editando-forma');
    pg.setAttribute('points', S.edTmp.poly.map(p => p.join(',')).join(' ')); svg.append(pg);
    const P = S.edTmp.poly;
    P.forEach(([x, y], i) => { const q = P[(i + 1) % P.length]; layer.append(h('span', { class: 'mid', 'data-i': i, title: 'Inserir canto', style: `left:${(x + q[0]) / 2}px;top:${(y + q[1]) / 2}px` }, '+')); });
    P.forEach(([x, y], i) => layer.append(h('span', { class: 'vtx', 'data-i': i, style: `left:${x}px;top:${y}px` })));
    for (const [id, v] of Object.entries(S.edTmp.viz || {})) {  // vizinhas que acompanharam uma aresta (ainda não salvas)
      const pv = svg.querySelector(`polygon[data-sala="${CSS.escape(id)}"]`); if (pv) { pv.setAttribute('points', v.poly.map(p => p.join(',')).join(' ')); pv.classList.add('viz-ed'); }
    }
  }
}
function atualizaVertices() {
  const P = S.edTmp.poly;
  const pg = $('#polyEd'); if (pg) pg.setAttribute('points', P.map(p => p.join(',')).join(' '));
  document.querySelectorAll('.vtx[data-i]').forEach(v => { const [x, y] = P[+v.dataset.i]; v.style.left = x + 'px'; v.style.top = y + 'px'; });
  document.querySelectorAll('.mid').forEach(m => {
    const a = P[+m.dataset.i], b = P[(+m.dataset.i + 1) % P.length]; if (!a || !b) return;
    m.style.left = (a[0] + b[0]) / 2 + 'px'; m.style.top = (a[1] + b[1]) / 2 + 'px';
    m.style.display = Math.hypot(b[0] - a[0], b[1] - a[1]) * S.zoom.s < 64 ? 'none' : '';  // aresta curta na tela: o "+" atrapalharia os cantos
  });
  for (const [id, v] of Object.entries(S.edTmp.viz || {})) {
    const pv = document.querySelector(`polygon[data-sala="${CSS.escape(id)}"]`); if (pv) { pv.setAttribute('points', v.poly.map(p => p.join(',')).join(' ')); pv.classList.add('viz-ed'); }
  }
}
// ---- ciclo 6c: arrastar a aresta inteira (a sala vizinha que divide a parede acompanha), inserir e apagar cantos ----
const TOL_VIZINHA_M = 0.3;
function pxPorMetro() { const M = (S.seed.plantas[S.planta] || {}).dwg_M; return M ? Math.hypot(M[0][0], M[1][0]) * 1000 : 22; }
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function arestaSob(x, y) {
  const P = S.edTmp.poly; let best = null, bd = 12 / S.zoom.s;
  P.forEach((a, i) => { const d = distSeg([x, y], a, P[(i + 1) % P.length]); if (d < bd) { bd = d; best = i; } });
  return best;
}
// arestas das outras salas que dividem a parede com a aresta a–b: os 2 vértices a menos de 0,3 m dela e na mesma direção
function vizinhasDaAresta(a, b, idSala) {
  const tol = TOL_VIZINHA_M * pxPorMetro(), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, out = [];
  for (const s of salasDe(S.planta)) {
    if (s.id === idSala || s.tipo !== 'sala' || !s.poly) continue;
    const Q = (S.edTmp.viz && S.edTmp.viz[s.id]) ? S.edTmp.viz[s.id].poly : s.poly; const idx = new Set();
    Q.forEach((q, k) => {
      const q2 = Q[(k + 1) % Q.length], l2 = Math.hypot(q2[0] - q[0], q2[1] - q[1]); if (!l2) return;
      const par = Math.abs((q2[0] - q[0]) * (b[1] - a[1]) - (q2[1] - q[1]) * (b[0] - a[0])) / (l2 * L) < 0.35;
      if (par && distSeg(q, a, b) <= tol && distSeg(q2, a, b) <= tol) { idx.add(k); idx.add((k + 1) % Q.length); }
    });
    if (idx.size) out.push({ s, idx: [...idx], p0: Q.map(q => [...q]) });
  }
  return out;
}
function iniciaAresta(i, p) {
  const P = S.edTmp.poly, j = (i + 1) % P.length, a = [...P[i]], b = [...P[j]], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (L * L)));
  S.dragE = { i, j, a, b, n: [-dy / L, dx / L], p0: [a[0] + t * dx, a[1] + t * dy], viz: vizinhasDaAresta(a, b, S.edTmp.sala.id) };
  const NS = 'http://www.w3.org/2000/svg', ln = document.createElementNS(NS, 'line'); ln.classList.add('aresta-sel'); ln.id = 'arestaSel';
  const svg = document.querySelector('svg.salas'); if (svg) svg.append(ln); moveAresta(S.dragE.p0);
}
function moveAresta(cur) {
  const d = S.dragE, [nx, ny] = d.n;  // a aresta anda na perpendicular; com o encaixe ligado, para na linha de parede do DWG
  let t = (cur[0] - d.p0[0]) * nx + (cur[1] - d.p0[1]) * ny;
  if (Math.abs(t) * S.zoom.s >= 3) { const q = encaixar([d.p0[0] + t * nx, d.p0[1] + t * ny]); t = (q[0] - d.p0[0]) * nx + (q[1] - d.p0[1]) * ny; } else t = 0;
  const dx = Math.round(t * nx), dy = Math.round(t * ny), P = S.edTmp.poly;
  P[d.i] = [d.a[0] + dx, d.a[1] + dy]; P[d.j] = [d.b[0] + dx, d.b[1] + dy];
  S.edTmp.viz = S.edTmp.viz || {};
  for (const v of d.viz) { const poly = v.p0.map(p => [...p]); for (const k of v.idx) poly[k] = [v.p0[k][0] + dx, v.p0[k][1] + dy]; S.edTmp.viz[v.s.id] = { sala: v.s, poly }; }
  const ln = $('#arestaSel'); if (ln) { ln.setAttribute('x1', P[d.i][0]); ln.setAttribute('y1', P[d.i][1]); ln.setAttribute('x2', P[d.j][0]); ln.setAttribute('y2', P[d.j][1]); }
  atualizaVertices();
}
function inserirVertice(i) {
  const P = S.edTmp.poly, a = P[i], b = P[(i + 1) % P.length];
  P.splice(i + 1, 0, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)]); S.ultVtx = null; render(); toast('Canto inserido – arraste para o lugar');
}
function apagarVertice(i) {
  const P = S.edTmp.poly; clearTimeout(S.longo);
  if (P.length <= 3) { toast('A sala precisa de pelo menos 3 cantos'); return; }
  P.splice(i, 1); render(); toast('Canto apagado');
}
async function salvarForma() {
  const s = S.edTmp.sala; const poly = S.edTmp.poly.map(p => [Math.round(p[0]), Math.round(p[1])]);
  const viz = Object.values(S.edTmp.viz || {}).filter(v => !mesmoPoly(v.poly, v.sala.poly));
  const rot = (o, p) => (o.label && pip(o.label, p) ? o.label : centroide(p));  // o rótulo fica onde estava, se continuar dentro
  await historico([s.id, ...viz.map(v => v.sala.id)]);  // um "desfazer" volta a sala e as vizinhas
  await gravarSala({ ...s, poly, label: rot(s, poly), planta: S.planta, editada: 1 }, 'forma', true);
  for (const v of viz) await gravarSala({ ...v.sala, poly: v.poly, label: rot(v.sala, v.poly), planta: S.planta, editada: 1 }, 'forma (aresta comum)', true);
  S.edModo = null; S.edTmp = null; render(); toast(viz.length ? `Forma salva – ${viz.length} sala(s) vizinha(s) acompanharam` : 'Forma da sala salva');
}
function centroide(poly) { return [Math.round(poly.reduce((a, p) => a + p[0], 0) / poly.length), Math.round(poly.reduce((a, p) => a + p[1], 0) / poly.length)]; }
function areaPoly(poly) { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]); return Math.abs(a / 2); }
// corta o polígono pela reta a–b (semiplano de cada lado – Sutherland–Hodgman com um plano)
function cortar(poly, a, b, lado) {
  const f = p => lado * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], fp = f(P), fq = f(Q);
    if (fp >= 0) out.push(P);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([Math.round(P[0] + t * (Q[0] - P[0])), Math.round(P[1] + t * (Q[1] - P[1]))]); }
  }
  return out;
}
async function dividir(s, a, b) {
  const A = cortar(s.poly, a, b, 1), B = cortar(s.poly, a, b, -1);
  if (A.length < 3 || B.length < 3 || areaPoly(A) < 4 || areaPoly(B) < 4) { toast('A linha precisa atravessar a sala'); S.edTmp.pts = []; render(); return; }
  const [maior, menor] = areaPoly(A) >= areaPoly(B) ? [A, B] : [B, A];
  const nova = { id: `U-${S.planta}-${Date.now().toString(36)}`, planta: S.planta, nivel: S.planta, tipo: 'sala', codigo: '?', nome: '', poly: menor, label: centroide(menor), nova: 1, dividida_de: s.id };
  await historico([s.id, nova.id]);
  await gravarSala({ ...s, poly: maior, label: centroide(maior), planta: S.planta, editada: 1, dividida: 1 }, 'dividida', true);
  await gravarSala(nova, 'nova (divisão)', true);
  S.edModo = null; S.edTmp = null; render(); toast('Sala dividida em duas – toque na parte nova para dar código e nome');
}
// junta duas salas: contorno da união (raster 2 px + contorno externo)
function uniao(p1, p2) {
  const xs = [...p1, ...p2].map(p => p[0]), ys = [...p1, ...p2].map(p => p[1]); const k = 2;
  const x0 = Math.min(...xs) - 4, y0 = Math.min(...ys) - 4, W = Math.ceil((Math.max(...xs) - x0 + 8) / k), H = Math.ceil((Math.max(...ys) - y0 + 8) / k);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineWidth = 3; g.lineJoin = 'round';
  for (const p of [p1, p2]) { g.beginPath(); p.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, (x - x0) / k, (y - y0) / k)); g.closePath(); g.fill(); g.stroke(); }
  const d = g.getImageData(0, 0, W, H).data; const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 0;
  let sx = -1, sy = -1; for (let y = 0; y < H && sx < 0; y++) for (let x = 0; x < W; x++) if (on(x, y)) { sx = x; sy = y; break; }
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; const pts = [[sx, sy]];
  let cx = sx, cy = sy, dir = 6;
  for (let n = 0; n < W * H; n++) {  // contorno de Moore
    let ok = false;
    for (let k2 = 0; k2 < 8; k2++) { const di = (dir + 6 + k2) % 8; const nx = cx + dirs[di][0], ny = cy + dirs[di][1]; if (on(nx, ny)) { cx = nx; cy = ny; dir = di; ok = true; break; } }
    if (!ok || (cx === sx && cy === sy)) break; pts.push([cx, cy]);
  }
  return simplifica(pts.map(([x, y]) => [Math.round(x * k + x0), Math.round(y * k + y0)]), 2.5);
}
function simplifica(p, eps) {  // Douglas–Peucker
  if (p.length < 4) return p;
  const dp = (a, b) => { let im = -1, dm = 0; const [x1, y1] = p[a], [x2, y2] = p[b]; const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((x2 - x1) * (y1 - p[i][1]) - (x1 - p[i][0]) * (y2 - y1)) / L; if (d > dm) { dm = d; im = i; } }
    return dm > eps ? [...dp(a, im).slice(0, -1), ...dp(im, b)] : [p[a], p[b]]; };
  const r = dp(0, p.length - 1); return r.length >= 3 ? r : p;
}
async function juntar(a, b) {
  const poly = uniao(a.poly, b.poly);
  await historico([a.id, b.id]);
  await gravarSala({ ...a, poly, label: a.label || centroide(poly), planta: S.planta, editada: 1, juntou: [...(a.juntou || []), b.id, ...(b.juntou || [])] }, 'juntada', true);
  await gravarSala({ ...b, planta: S.planta, excluida: 1, juntada_em: a.id }, 'excluida (juntada)', true);
  S.edModo = null; S.edTmp = null; render(); toast(`${rotuloSala(b)} juntada em ${rotuloSala(a)}`);
}
function proximaNaoRevisada() {
  const ss = salasDe(S.planta).filter(x => x.tipo === 'sala' && !x.revisada).sort((x, y) => (x.codigo === '?') - (y.codigo === '?') || (x.codigo + x.id).localeCompare(y.codigo + y.id));
  if (!ss.length) { toast('Todas as salas deste andar estão revisadas'); return; }
  const i = ss.findIndex(x => (x.codigo + x.id).localeCompare(S.edUlt || '') > 0); const s = ss[i >= 0 ? i : 0]; S.edUlt = s.codigo + s.id;
  const w = $('#mapwrap'); const [lx, ly] = s.label || centroide(s.poly); const z = Math.max(S.zoom.s, (S.zoom.fit || S.zoom.s) * 2.5);
  S.zoom.s = z; S.zoom.x = w.clientWidth / 2 - lx * z; S.zoom.y = w.clientHeight / 2 - ly * z; applyZoom();
  editarSala(s);
}
// lista de códigos/nomes (DWG, as-built, roombook, conferência) para o campo de código
function listaCatalogo() {
  let dl = document.getElementById('catSalas'); if (dl) return dl;
  dl = h('datalist', { id: 'catSalas' });
  const vis = new Set();
  for (const c of (S.seed.catalogo_salas || [])) { vis.add(c.c); dl.append(h('option', { value: c.c, label: `${c.n || ''} · ${c.f}` })); }
  for (const s of todasSalas()) if (s.codigo && s.codigo !== '?' && !vis.has(s.codigo) && s.tipo === 'sala') { vis.add(s.codigo); dl.append(h('option', { value: s.codigo, label: s.nome || '' })); }
  document.body.append(dl); return dl;
}
function formSala(s, titulo, onSalvar, comExcluir) {
  const form = h('form', { class: 'ficha', onsubmit: async ev => {
    ev.preventDefault(); const fd = new FormData(form);
    await onSalvar({ codigo: (fd.get('codigo') || '').trim() || '?', nome: (fd.get('nome') || '').trim(), tipo: fd.get('tipo'), nota: fd.get('nota') || '', marca: fd.get('marca') || s.marca,
      revisada: fd.get('revisada') ? 1 : 0 });
  } },
    h('h2', {}, titulo),
    h('div', { class: 'grid' },
      h('label', {}, 'Código (lista com busca ou digite)', h('input', { name: 'codigo', id: 'inCodigo', list: (listaCatalogo(), 'catSalas'), autocomplete: 'off',
        value: s.codigo && s.codigo !== '?' ? s.codigo : '', placeholder: '?', oninput: ev => {
          const c = (S.seed.catalogo_salas || []).find(x => x.c === ev.target.value.trim()); const nm = ev.target.form.querySelector('[name=nome]');
          if (c && nm && !nm.value) nm.value = c.n || ''; } })),
      h('label', {}, 'Nome', h('input', { name: 'nome', value: s.nome || '' })),
      s.tipo === 'sala' || !s.tipo ? h('label', { class: 'chk full' }, h('input', { type: 'checkbox', name: 'revisada', id: 'chkRevisada', checked: !!s.revisada }), ' Sala revisada (conferi contorno, código e nome)') : null,
      h('label', {}, 'Tipo', h('select', { name: 'tipo' }, [['sala', 'Sala'], ['area', 'Área (agrupa salas/subáreas)'], ['marca', 'Subárea / marcação'], ['externa', 'Área externa']].map(([v, t]) => h('option', { value: v, selected: v === (s.tipo || 'sala') }, t)))),
      h('label', {}, 'Marcação (se subárea)', h('select', { name: 'marca' }, h('option', { value: '' }, '—'), Object.keys(COR_MARCA).map(k => h('option', { value: k, selected: k === s.marca }, k)))),
      h('label', { class: 'full' }, 'Nota', h('textarea', { name: 'nota', rows: 2 }, s.nota || ''))),
    h('div', { class: 'acts' },
      comExcluir ? h('button', { type: 'button', class: 'danger', id: 'btnExcluirSala', onclick: async () => { await gravarSala({ ...s, planta: S.planta, excluida: 1 }); fecharModal(); toast('Sala excluída'); } }, 'Excluir sala') : null,
      comExcluir && s.poly ? h('button', { type: 'button', id: 'btnVertices', onclick: () => { S.edModo = 'vertices'; S.edTmp = { sala: s, poly: s.poly.map(p => [...p]) }; fecharModal(); } }, '⬚ Editar forma (arestas e cantos)') : null,
      h('button', { type: 'button', onclick: fecharModal }, 'Cancelar'), h('button', { type: 'submit', class: 'primary' }, 'Salvar')));
  modal(form);
}
function editarSala(s) {
  formSala(s, `Editar ${rotuloSala(s)}`, async v => { await gravarSala({ ...s, ...v, planta: S.planta, editada: 1 }); fecharModal(); toast('Sala atualizada'); }, true);
}
function salvarSalaNova() {
  const poly = S.draw; const cx = Math.round(poly.reduce((a, p) => a + p[0], 0) / poly.length), cy = Math.round(poly.reduce((a, p) => a + p[1], 0) / poly.length);
  const base = { id: `U-${S.planta}-${Date.now().toString(36)}`, planta: S.planta, nivel: S.planta, tipo: 'sala', codigo: '?', nome: '', poly, label: [cx, cy], nova: 1 };
  formSala(base, 'Nova sala', async v => { S.draw = null; await gravarSala({ ...base, ...v }); fecharModal(); toast('Sala criada'); }, false);
}

// ---------- painel de sala / área ----------
function abrirSala(s, q) {
  const novo = !S.painel;
  if (!S.filtro || S.filtro.sala !== s.id) { S.filtro = { sala: s.id, q: q || '', pref: '' }; S.abertos = {}; }  // o filtro vale enquanto estiver na sala
  else if (q != null) { S.filtro.q = q; S.filtro.pref = ''; }
  S.painel = s; if (novo) empilhar('painel', fecharPainelJa);
  entrouSala(s).then(() => { if (S.painel === s) renderPainel(); }); renderPainel();
  if (S.view === 'planta') { const pg = document.querySelector(`polygon[data-sala="${CSS.escape(s.id)}"]`); document.querySelectorAll('polygon.sel').forEach(p => p.classList.remove('sel')); if (pg) pg.classList.add('sel'); }
}
function fecharPainelJa() { S.painel = null; $('#painel').classList.remove('on'); if (S.view === 'planta') render(); }
function fecharPainel() { if (!desempilhar('painel')) fecharPainelJa(); }
const prefixo = tag => (String(tag || '').match(/^[A-Za-z]+/) || [String(tag || '')])[0];
function filtraSala(its) {
  const f = S.filtro || {}; const t = (f.q || '').trim().toLowerCase();
  return its.filter(i => (!f.pref || prefixo(i.tag) === f.pref) && (!t || [i.id, i.tag, i.equip, i.vol, i.crate].some(v => String(v ?? '').toLowerCase().includes(t))));
}
// sala (da planta) onde o item deveria estar, pelo Schedule/layout; e onde ele está agora (o informado na ficha vale mais)
const SL_TODOS = () => ({ id: '__SL__', planta: 'SL', tipo: 'area', codigo: (S.seed.plantas.SL && S.seed.plantas.SL.titulo) || 'Sala limpa', nome: 'todos os itens' });
function salaOrigem(it) {
  if (it.local) return salaPorId(it.local) || null;
  if (it.area || it.sub) return salasDe('SL').find(x => x.id === it.area) || salasDe('SL').find(x => x.id === it.sub) || null;
  if (S.seed.plantas.SL && (it.sala === (S.seed.plantas.SL.sala_itens || 'SALA LIMPA') || it.planta_novo === 'SL')) return SL_TODOS();
  return null;
}
function origemNa(it, s) {
  if (s.id === '__SL__' || s.tipo === 'bloco') return (salaOrigem(it) || {}).planta === 'SL';
  if (s.planta === 'SL') return it.area === s.id || it.sub === s.id;
  return [s.id, ...(s.juntou || [])].includes(it.local);
}
const nomeLocal = s => S.aliasInv[s.id] || (s.planta === 'SL' && s.id !== '__SL__' ? `Sala limpa · ${codSala(s)}` : codSala(s));
function ondeEsta(it) {
  const o = est(it.id).onde;
  if (o) { const s = salaPorId(o) || salaPorId(S.alias[o]); return s ? { s, k: s.id, rot: nomeLocal(s), informado: true } : { s: null, k: 'local:' + o, rot: o, informado: true }; }
  const s = salaOrigem(it); return s ? { s, k: s.id, rot: nomeLocal(s) } : { s: null, k: 'local:' + (it.sala || '—'), rot: it.sala || '—' };
}
const itensDoEquip = tag => S.itens.filter(i => i.tag === tag);
// "1 aqui · 3 na L0.P.105": onde estão os volumes de um equipamento, contados por local (o local "aqui" vem primeiro)
function resumoLocais(its, aquiId) {
  const m = new Map();
  for (const it of its) { const o = ondeEsta(it); const g = m.get(o.k) || { ...o, n: 0 }; g.n++; m.set(o.k, g); }
  return [...m.values()].sort((a, b) => (b.k === aquiId) - (a.k === aquiId) || b.n - a.n);
}
function grupoPorEquip(its) {
  const m = new Map();
  for (const it of its) { if (!m.has(it.tag)) m.set(it.tag, []); m.get(it.tag).push(it); }
  return [...m.entries()].sort((a, b) => (a[1][0].lote + a[0]).localeCompare(b[1][0].lote + b[0]));
}
function renderPainel() {
  const s = S.painel; const p = $('#painel');
  if (!s) { p.innerHTML = ''; return; }
  const ant = p.querySelector('.pbody'); const rol = ant && p.dataset.sala === s.id ? ant.scrollTop : 0; p.dataset.sala = s.id;  // mesma sala: mesma rolagem
  const foco = document.activeElement && document.activeElement.id === 'filtroSala';
  p.innerHTML = '';
  const todosSala = itensDaSala(s); const todos = filtraSala(todosSala);
  const its = ativos(todos); const foraL = todos.filter(foraEsc); const divL = todos.filter(it => divEsc(it) && !foraEsc(it));
  const nota = est('SALA:' + s.id); const f = S.filtro || (S.filtro = { sala: s.id, q: '', pref: '' });
  const insp = inspLigada(); const lemb = lembretes(s);
  const prefs = [...new Set(todosSala.map(i => prefixo(i.tag)))].sort();
  const filtrando = !!(f.pref || (f.q || '').trim());
  const head = h('div', { class: 'phead' },
    h('div', {}, h('button', { class: 'voltar', id: 'btnVoltarPainel', onclick: fecharPainel }, '← Voltar'), h('h2', {}, rotuloSala(s) || s.id),
      h('div', { class: 'sub' }, `${{ sala: 'Sala', area: 'Área', marca: 'Subárea / marcação', externa: 'Área externa' }[s.tipo] || ''}${s.area_m2 ? ' · ' + Math.round(s.area_m2) + ' m²' : ''} · ${its.length} itens · ${conferidos(its)} conferidos`,
        s.duvida ? h('div', { class: 'nota duvida', id: 'avisoDuvida' }, '⚠ ' + s.duvida) : null,
        s.nota ? h('div', { class: 'nota' }, '📌 ' + s.nota) : null, nota.com ? h('div', { class: 'nota' }, '📝 ' + nota.com) : null,
        lemb.length ? h('div', { class: 'nota lembrete', id: 'lembreteSala' }, `⚡ Nesta sala: ${lemb.map(l => l.rot).join(' · ')} – fotografar`) : null)),
    h('div', { class: 'pact' },
      insp ? h('button', { id: 'btnAbertura', title: 'Mostrar de novo a tela de abertura para o fotógrafo', onclick: async () => { await entrouSala(s); telaAbertura(s); } }, '📺 Mostrar de novo') : null,
      h('button', { id: 'btnDetalhes', class: S.det ? 'on' : '', 'aria-pressed': String(!!S.det), title: 'Mostrar peso e dimensões de todos os itens', onclick: () => { S.det = !S.det; S.detIt.clear(); renderPainel(); } }, S.det ? 'Detalhes: ligados' : 'Detalhes'),
      h('button', { id: 'btnNotasSala', onclick: () => notasSala(s) }, '📝 Notas / inspeção'),
      h('button', { id: 'btnNovoItem', onclick: () => novoItem(s) }, '+ Item não previsto'),
      h('button', { class: 'x', onclick: fecharPainel, 'aria-label': 'Fechar' }, '✕')));
  // filtro da sala (ciclo 7): texto (tag, equipamento, CF-ID, volume) + botões rápidos com os prefixos das tags presentes
  const inp = h('input', { type: 'search', id: 'filtroSala', placeholder: 'Filtrar: tag, equipamento, CF-ID, volume…', value: f.q || '', autocomplete: 'off',
    oninput: ev => { f.q = ev.target.value; renderPainel(); } });
  const barra = todosSala.length > 1 ? h('div', { class: 'pfiltro' }, inp,
    prefs.length > 1 ? h('div', { class: 'prefs', id: 'prefsSala' }, prefs.map(pf => h('button', { class: 'chip sm' + (f.pref === pf ? ' on' : ''), 'data-pref': pf,
      onclick: () => { f.pref = f.pref === pf ? '' : pf; renderPainel(); } }, pf))) : null,
    filtrando ? h('div', { class: 'sub', id: 'nFiltro' }, `${todos.length} de ${todosSala.length} itens `, h('button', { class: 'mini', id: 'btnLimparFiltro', onclick: () => { f.q = ''; f.pref = ''; renderPainel(); } }, '✕ limpar filtro')) : null) : null;
  const body = h('div', { class: 'pbody' });
  if (insp) body.append(secFotos(s));  // modo inspeção: as fotos da sala vêm antes da lista de equipamentos
  const grupos = grupoPorEquip(its);
  for (const [tag, lst] of grupos) body.append(blocoEquip(tag, lst, grupos.length <= 3, s));
  if (!its.length && filtrando) body.append(h('p', { class: 'vazio' }, 'Nenhum item desta sala passa no filtro.'));
  else if (!its.length) body.append(h('p', { class: 'vazio' }, foraL.length || divL.length ? 'Todos os itens daqui estão fora do escopo ou em divergência.' : 'Nenhum item previsto aqui. Use "+ Item não previsto" para registrar o que encontrar, "Fotos da sala" para fotografar e "Notas / inspeção" para observações.'));
  if (!insp) body.append(secFotos(s));  // fora do modo inspeção, as fotos da sala ficam depois dos equipamentos (só aqui; "Notas" tem só o texto)
  if (foraL.length) { // à parte, recolhido: não conta na planta, mas dá para rever e desfazer
    const det = h('details', { class: 'eq fora-grupo', id: 'grupoFora' }, h('summary', {}, h('b', {}, `⊘ ${ESC().rotulo_fora} (${foraL.length})`),
      h('span', { class: 'nm' }, ' não contam na planta nem nas pendências')));
    for (const it of foraL) det.append(linhaItem(it));
    body.append(det);
  }
  if (divL.length) {
    const det = h('details', { class: 'eq div-grupo', id: 'grupoDiv', open: true }, h('summary', {}, h('b', {}, `⚠ Divergências – ${ESC().rotulo_diverg} (${divL.length})`),
      h('span', { class: 'nm' }, ' com comentário e foto; não contam nas pendências')));
    for (const it of divL) det.append(linhaItem(it));
    body.append(det);
  }
  p.append(...[head, barra, body].filter(Boolean)); p.classList.add('on'); body.scrollTop = rol;
  if (foco) { inp.focus(); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch { /* campo de busca sem seleção */ } }
}
// marca/desmarca "fora do escopo" num conjunto de itens (ficha ou lote por equipamento) – reversível
async function marcarFora(lst, motivo, obs) {
  for (const it of lst) {
    const e = { ...est(it.id), fora: motivo || '', fora_obs: motivo ? (obs || '') : '', ts: Date.now() };
    S.estado.set(it.id, e); await DB.put('estado', e);
    await log('item', it.id, 'fora', motivo ? `${motivo}${obs ? ' – ' + obs : ''}` : '(voltou ao escopo)');
  }
}
async function marcarDiverg(lst, motivo, obs, fotoIds) {
  for (const it of lst) {
    const e0 = est(it.id);
    const e = { ...e0, diverg: motivo || '', diverg_obs: motivo ? (obs || '') : '', fotos: [...new Set([...(e0.fotos || []), ...(fotoIds || [])])], ts: Date.now() };
    S.estado.set(it.id, e); await DB.put('estado', e);
    await log('item', it.id, 'divergência', motivo ? `${motivo} – ${obs}` : '(divergência resolvida)');
  }
}
function loteDiverg(tag, lst) {
  const alvo = ativos(lst); let fotos = [];
  const box = h('div', { class: 'thumbs' });
  const form = h('form', { class: 'ficha', onsubmit: async ev => {
    ev.preventDefault(); const fd = new FormData(form);
    if (!fd.get('motivo') || !(fd.get('obs') || '').trim() || !fotos.length) { toast('Divergência exige motivo, comentário e foto'); return; }
    await marcarDiverg(alvo, fd.get('motivo'), fd.get('obs').trim(), fotos.map(f => f.id));
    await log('lote', tag, 'Divergência (todos)', `${alvo.length} · ${fd.get('motivo')}`);
    fecharModal(); toast(`${alvo.length} itens de ${tag} em divergência`);
  } },
    h('h2', {}, `${tag} – ${ESC().rotulo_diverg}`),
    h('p', { class: 'sub' }, `Registra divergência para os ${alvo.length} itens de ${tag}. Exige comentário e pelo menos uma foto (do local onde deveria estar). Conta à parte no Resumo e no dashboard.`),
    h('div', { class: 'grid' },
      h('label', {}, 'Motivo', h('select', { name: 'motivo', id: 'loteDivMotivo' }, h('option', { value: '' }, '—'), ESC().motivos_diverg.map(m => h('option', { value: m }, m)))),
      h('label', { class: 'full' }, 'Comentário (obrigatório)', h('textarea', { name: 'obs', id: 'loteDivObs', rows: 2, placeholder: 'onde procurou, quem confirmou…' }))),
    h('div', { class: 'fotos' }, h('b', {}, 'Foto (obrigatória)'), box,
      h('label', { class: 'btn' }, '📷 Tirar / escolher foto', h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, name: 'foto', id: 'loteDivFoto',
        onchange: async ev => { for (const f of ev.target.files) { const fo = await addFoto(f, alvo[0]); fotos.push(fo); box.append(thumb(fo)); } ev.target.value = ''; } }))),
    h('div', { class: 'acts' }, h('button', { type: 'button', onclick: fecharModal }, 'Cancelar'), h('button', { type: 'submit', class: 'primary', id: 'btnLoteDiv' }, `Registrar ${alvo.length} itens`)));
  modal(form);
}
function loteFora(tag, lst) {
  const alvo = ativos(lst);
  const form = h('form', { class: 'ficha', onsubmit: async ev => {
    ev.preventDefault(); const fd = new FormData(form);
    if (!fd.get('motivo')) { toast('Escolha o motivo'); return; }
    await marcarFora(alvo, fd.get('motivo'), fd.get('obs') || '');
    await log('lote', tag, 'Fora do escopo (todos)', `${alvo.length} · ${fd.get('motivo')}`);
    fecharModal(); toast(`${alvo.length} itens de ${tag} fora do escopo`);
  } },
    h('h2', {}, `${tag} – ${ESC().rotulo_fora}`),
    h('p', { class: 'sub' }, `Só para motivo documentado. Marca os ${alvo.length} itens de ${tag} ${lst[0].equip ? '(' + lst[0].equip + ') ' : ''}listados aqui. Eles saem da planta e das pendências, mas ficam na Lista (filtro "Fora do escopo"), no histórico e no pacote do dia. Dá para desfazer. Item que não foi encontrado é divergência, não fora do escopo.`),
    h('div', { class: 'grid' },
      h('label', {}, 'Motivo', h('select', { name: 'motivo', id: 'loteMotivo' }, h('option', { value: '' }, '—'), ESC().motivos_fora.map(m => h('option', { value: m }, m)))),
      h('label', {}, 'Detalhe (opcional)', h('input', { name: 'obs', placeholder: 'ex.: retirado no lote 1, em 2025' }))),
    h('div', { class: 'acts' }, h('button', { type: 'button', onclick: fecharModal }, 'Cancelar'), h('button', { type: 'submit', class: 'primary', id: 'btnLoteFora' }, `Marcar ${alvo.length} itens`)));
  modal(form);
}
async function notasSala(s) {
  const id = 'SALA:' + s.id; const e = est(id);
  const form = h('form', { class: 'ficha', onsubmit: async ev => {
    ev.preventDefault(); const fd = new FormData(form);
    await setEstado(id, { com: fd.get('com') || '', estado: fd.get('estado') || '' }, 'notas sala', fd.get('com') || '');
    fecharModal(); toast('Notas salvas');
  } },
    h('h2', {}, `Notas / inspeção – ${rotuloSala(s)}`),
    h('p', { class: 'sub' }, 'Observações gerais da sala (piso, paredes, forro, portas, iluminação, infiltração, elétrica). As fotos ficam em "Fotos da sala", no painel.'),
    h('div', { class: 'grid' },
      h('label', {}, 'Condição geral', h('select', { name: 'estado' }, h('option', { value: '' }, '—'), ['Boa', 'Regular', 'Ruim', 'Interditada'].map(o => h('option', { value: o, selected: o === e.estado }, o)))),
      h('label', { class: 'full' }, 'Observações', h('textarea', { name: 'com', rows: 4 }, e.com || ''))),
    h('div', { class: 'acts' }, h('button', { type: 'button', onclick: fecharModal }, 'Cancelar'), h('button', { type: 'submit', class: 'primary' }, 'Salvar')));
  modal(form);
}

// ---------- fotos da sala (ciclo 8): registro com comentário, equipamento e ponto na planta ----------
const lembretes = s => { const L = (S.seed && S.seed.lembretes) || {}; return [...(L[s.id] || []), ...(s.codigo && s.codigo !== s.id ? (L[s.codigo] || []) : [])]; };
function urlFoto(id) {  // miniatura: a imagem é lida do aparelho uma vez e reaproveitada
  if (!S.thumbUrl.has(id)) S.thumbUrl.set(id, DB.get('fotos', id).then(f => (f && f.blob ? URL.createObjectURL(f.blob) : '')));
  return S.thumbUrl.get(id);
}
function thumbReg(m, s) {
  const img = h('img', { alt: m.nome }); urlFoto(m.id).then(u => { if (u) img.src = u; });
  const marcas = [m.com ? '💬' : '', m.equip ? '🔧' : '', m.ponto ? '📍' : ''].join('');
  return h('figure', { class: 'reg', 'data-foto': m.id, title: 'Tocar para comentar, ligar a um equipamento ou marcar o ponto', onclick: () => editarFoto(m.id, s) },
    img, h('figcaption', {}, `${m.id} ${marcas}`), m.com ? h('div', { class: 'reg-com' }, m.com) : null, m.equip ? h('div', { class: 'reg-eq' }, m.equip) : null);
}
// seção "Fotos da sala": câmera contínua (foto → foto → foto, sem sair da tela) e, como alternativa, a câmera/galeria do aparelho
function secFotos(s) {
  const l = fotosDaSala(s);
  const aoEscolher = async ev => { const fs = [...ev.target.files]; ev.target.value = ''; for (const f of fs) await addFotoSala(f, s); renderPainel(); };
  return h('section', { class: 'fotos-sala', id: 'fotosSala' },
    h('div', { class: 'fs-head' }, h('b', { id: 'nFotosSala' }, `📷 Fotos da sala (${l.length})`),
      h('button', { type: 'button', class: 'primary', id: 'btnFotografar', onclick: () => abrirCamera(s) }, '📷 Fotografar'),
      h('label', { class: 'btn mini' }, '🖼 Do aparelho', h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, name: 'foto', id: 'inFotoSala', onchange: aoEscolher })),
      h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, id: 'inFotoCap', onchange: aoEscolher })),
    l.length ? null : h('p', { class: 'sub' }, 'Sem fotos ainda. "Fotografar" abre a câmera e tira várias fotos seguidas; o comentário pode ficar para depois.'),
    h('div', { class: 'thumbs', id: 'thumbsSala' }, l.map(m => thumbReg(m, s))),
    l.length ? h('p', { class: 'sub' }, 'Toque numa foto para comentar, ligar a um equipamento ou marcar o ponto na planta.') : null);
}
async function addFotoSala(file, s) {
  return addFoto(file, { id: 'SALA:' + s.id, tag: 'SALA' }, s.codigo && s.codigo !== '?' ? s.codigo : s.id,
    { sala_id: s.id, planta: s.planta || S.planta, origem: 'app', com: '', equip: '', ponto: null, reg: 1 });
}
// câmera dentro do app: cada toque no disparador grava uma foto e a câmera continua aberta
async function abrirCamera(s) {
  let stream = null;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } } }); }
  catch { const i = $('#inFotoCap'); if (i) { toast('Câmera do app indisponível – abrindo a câmera do aparelho'); i.click(); } return; }
  const video = h('video', { autoplay: true, playsinline: true, muted: true }); video.srcObject = stream; video.muted = true;
  const cnt = h('b', { id: 'camN' }, '0 fotos'), ult = h('img', { id: 'camUlt', alt: '' }); let n = 0, fila = Promise.resolve();
  const disparar = () => {
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 120);
    fila = fila.then(async () => {
      let blob = null; const tr = stream.getVideoTracks()[0];
      try { if (window.ImageCapture && !window.__TEST__) blob = await new ImageCapture(tr).takePhoto(); } catch { blob = null; }  // resolução cheia do sensor, se houver
      if (!blob) { const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext('2d').drawImage(video, 0, 0); blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)); }
      const m = await addFotoSala(blob, s); n++; cnt.textContent = `${n} foto${n === 1 ? '' : 's'}`; ult.src = await urlFoto(m.id);
    }).catch(x => toast('Foto não gravada: ' + x.message));
  };
  const el = h('div', { id: 'camera' }, video,
    h('div', { class: 'cam-topo' }, h('b', {}, `📷 ${codSala(s)}`), h('span', {}, 'foto → foto → foto; o comentário fica para depois')),
    h('div', { class: 'cam-barra' }, h('span', { class: 'cam-ult' }, ult, cnt),
      h('button', { id: 'btnDisparo', 'aria-label': 'Tirar foto', onclick: disparar }),
      h('button', { id: 'btnCamFim', class: 'primary', onclick: () => { if (!desempilhar('camera')) fim(); } }, 'Concluir')));
  const fim = () => { stream.getTracks().forEach(t => t.stop()); fila.then(() => { el.remove(); if (S.painel) renderPainel(); }); };
  document.body.append(el); empilhar('camera', fim);
}
// miniatura da sala: toque marca o ponto (coordenadas do mapa) onde a foto foi tirada
function miniSala(s, ponto, aoMarcar) {
  const NS = 'http://www.w3.org/2000/svg', plId = s.planta || S.planta, pl = S.seed.plantas[plId] || S.seed.plantas[S.planta];
  let x0 = 0, y0 = 0, w = pl.w, hh = pl.h;
  if (s.poly && s.poly.length) {
    const xs = s.poly.map(p => p[0]), ys = s.poly.map(p => p[1]); const mx = Math.max(40, (Math.max(...xs) - Math.min(...xs)) * 0.12), my = Math.max(40, (Math.max(...ys) - Math.min(...ys)) * 0.12);
    x0 = Math.min(...xs) - mx; y0 = Math.min(...ys) - my; w = Math.max(...xs) - Math.min(...xs) + 2 * mx; hh = Math.max(...ys) - Math.min(...ys) + 2 * my;
  }
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `${x0} ${y0} ${w} ${hh}`); svg.id = 'miniSala'; svg.classList.add('mini-sala');
  const im = document.createElementNS(NS, 'image'); im.setAttribute('href', S.plantaUrls[plId] || ''); im.setAttribute('width', pl.w); im.setAttribute('height', pl.h); svg.append(im);
  if (s.poly) { const pg = document.createElementNS(NS, 'polygon'); pg.setAttribute('points', s.poly.map(p => p.join(',')).join(' ')); svg.append(pg); }
  const pt = document.createElementNS(NS, 'circle'); pt.setAttribute('r', Math.max(w, hh) / 45); svg.append(pt);
  const poe = p => { pt.style.display = p ? '' : 'none'; if (p) { pt.setAttribute('cx', p[0]); pt.setAttribute('cy', p[1]); } };
  poe(ponto);
  svg.addEventListener('click', ev => {
    const m = svg.getScreenCTM(); if (!m) return; const q = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    const p = [Math.round(q.x), Math.round(q.y)]; poe(p); aoMarcar(p);
  });
  svg.limpar = () => poe(null);
  return svg;
}
async function editarFoto(id, s) {
  const f = await DB.get('fotos', id); if (!f) return;
  s = s || salaPorId(f.sala_id) || { id: f.sala_id, codigo: f.sala, planta: f.planta };
  let ponto = f.ponto || null;
  const daSala = grupoPorEquip(itensDaSala(s)).map(([tag, lst]) => [tag, lst[0].equip || '']);
  const selEq = h('select', { name: 'equip', id: 'fotoEq' });
  const montaEq = filtro => {
    const val = selEq.options.length ? selEq.value : (f.equip || ''), t = (filtro || '').trim().toLowerCase(), passa = ([tag, nm]) => !t || `${tag} ${nm}`.toLowerCase().includes(t) || tag === val;
    const op = ([tag, nm]) => h('option', { value: tag, selected: tag === val }, `${tag}${nm ? ' · ' + nm : ''}`);
    const aqui = daSala.filter(passa), tags = new Set(daSala.map(x => x[0]));
    const outros = t || (val && !tags.has(val)) ? S.seed.equips.filter(e => !tags.has(e.tag)).map(e => [e.tag, e.nome || '']).filter(passa).slice(0, 30) : [];
    selEq.innerHTML = '';
    selEq.append(h('option', { value: '', selected: !val }, '— nenhum —'), ...(aqui.length ? [h('optgroup', { label: 'Nesta sala' }, aqui.map(op))] : []), ...(outros.length ? [h('optgroup', { label: 'Outros equipamentos' }, outros.map(op))] : []));
    if (val && ![...selEq.options].some(o => o.value === val)) selEq.append(h('option', { value: val, selected: true }, val));
    selEq.value = val;
  };
  montaEq('');
  const img = h('img', { class: 'foto-grande', alt: f.nome, src: await urlFoto(id) });
  const mini = miniSala(s, ponto, p => { ponto = p; $('#fotoPonto').textContent = `ponto ${p[0]}, ${p[1]}`; });
  const form = h('form', { class: 'ficha', id: 'fichaFoto', onsubmit: async ev => {
    ev.preventDefault(); const fd = new FormData(form);
    const novo = { ...(await DB.get('fotos', id)), com: (fd.get('com') || '').trim(), equip: fd.get('equip') || '', ponto, planta: f.planta || s.planta || S.planta, ts_edit: Date.now() };
    await DB.put('fotos', novo);
    const l = S.fotosSala.get(f.sala_id) || [], i = l.findIndex(x => x.id === id), { blob, ...m } = novo; if (i >= 0) l[i] = m;
    await log('foto', id, 'registro', [novo.com, novo.equip, ponto ? `ponto ${ponto.join(',')}` : ''].filter(Boolean).join(' | '), { sala: f.sala_id });
    fecharModal(); toast(`${id} atualizada`);
  } },
    h('h2', {}, `${id} · ${rotuloSala(s) || f.sala}`), h('p', { class: 'sub' }, `${fmtD(f.ts)} · origem: ${f.origem || 'app'} · ${f.nome}`), img,
    h('div', { class: 'grid' },
      h('label', { class: 'full' }, 'Comentário (só se a foto não deixar claro)', h('textarea', { name: 'com', id: 'fotoCom', rows: 2 }, f.com || '')),
      h('div', { class: 'fl full' }, 'Equipamento (opcional)',
        h('input', { type: 'search', id: 'fotoEqBusca', placeholder: 'Buscar tag ou nome…', autocomplete: 'off', oninput: ev => montaEq(ev.target.value) }), selEq),
      h('div', { class: 'fl full' }, 'Ponto na planta (opcional): toque na miniatura da sala', mini,
        h('div', { class: 'sub' }, h('span', { id: 'fotoPonto' }, ponto ? `ponto ${ponto[0]}, ${ponto[1]}` : 'sem ponto'), ' ',
          h('button', { type: 'button', class: 'mini', id: 'btnLimparPonto', onclick: () => { ponto = null; mini.limpar(); $('#fotoPonto').textContent = 'sem ponto'; } }, 'Limpar ponto')))),
    h('div', { class: 'acts' }, h('button', { type: 'button', onclick: fecharModal }, 'Cancelar'), h('button', { type: 'submit', class: 'primary', id: 'btnSalvarFoto' }, 'Salvar')));
  modal(form);
}

function blocoEquip(tag, lst, abrir = false, sala = null) {
  const pr = progresso(lst); const nAt = ativos(lst).length;
  const det = h('details', { class: 'eq', open: S.abertos[tag] ?? (abrir || lst.length <= 12), 'data-tag': tag, ontoggle: () => { S.abertos[tag] = det.open; } });
  const eqInfo = (S.seed.equips.find(e => e.tag === tag) || {});
  const stop = fn => async ev => { ev.preventDefault(); ev.stopPropagation(); await fn(); };
  det.append(h('summary', {},
    h('span', { class: 'bar', style: `--p:${Math.round(pr * 100)}%;--c:${cor(pr)}` }),
    h('b', {}, tag), h('span', { class: 'nm' }, ` ${lst[0].equip || ''} · ${lst[0].lote}`),
    h('span', { class: 'cnt' }, nAt ? `${conferidos(lst)}/${nAt} conf.` : lst.some(divEsc) ? 'divergência' : 'fora do escopo'),
    eqInfo.dia_caminhao ? h('span', { class: 'cam' }, `🚚 ${eqInfo.dia_caminhao.split('-').reverse().join('/')}`) : null,
    nAt ? h('button', { class: 'mini', onclick: stop(() => conferirTodos(lst)) }, '✓ Conferir todos') : null,
    nAt ? h('button', { class: 'mini div-btn', title: ESC().rotulo_diverg, onclick: stop(() => loteDiverg(tag, lst)) }, '⚠ Não encontrado') : null,
    nAt ? h('button', { class: 'mini fora-btn', title: ESC().rotulo_fora, onclick: stop(() => loteFora(tag, lst)) }, '⊘ Fora do escopo')
      : h('button', { class: 'mini', onclick: stop(async () => { const f = lst.filter(foraEsc), d = lst.filter(divEsc); await marcarFora(f, ''); await marcarDiverg(d, ''); await log('lote', tag, 'Voltou ao escopo (todos)', lst.length); refrescar(); toast(`${lst.length} itens de ${tag} de volta ao escopo`); }) }, '↺ Voltar ao escopo')));
  if (sala) {  // dentro da sala: o equipamento inteiro (os volumes que estão em outras salas)
    const todos = itensDoEquip(tag); const loc = resumoLocais(todos, sala.id);
    const aqui = loc.filter(g => g.k === sala.id).reduce((a, g) => a + g.n, 0); const fora = loc.filter(g => g.k !== sala.id);
    det.append(h('div', { class: 'eq-todo', 'data-eqtodo': tag },
      `Este equipamento tem ${todos.length} volume${todos.length === 1 ? '' : 's'}: `, fora.length ? `${aqui} aqui · ${fora.map(g => `${g.n} ${g.s ? 'na' : 'em'} ${g.rot}`).join(' · ')} ` : (todos.length === 1 ? 'está aqui ' : 'todos aqui '),
      h('button', { class: 'mini', 'data-vertodos': tag, onclick: () => abrirEquip(tag) }, fora.length ? '→ ver todos' : '→ ver equipamento')));
  }
  for (const it of lst) det.append(linhaItem(it));
  return det;
}
function linhaItem(it, consulta = false) {
  const e = est(it.id); const nx = proxima(it);
  const row = h('div', { class: 'it' + (nx === 5 ? ' done' : '') + (e.fora ? ' fora' : '') + (e.diverg ? ' diverg' : '') + (consulta ? ' consulta' : ''), 'data-id': it.id });
  // peso e dimensões ficam ocultos; aparecem em "Detalhes" (no item, ou no botão do painel, que vale para a sala toda)
  const temDet = !!(it.peso || it.dim); const det = temDet && (S.det || S.detIt.has(it.id));
  const troca = () => { if (S.eqSel) renderVista(); else row.replaceWith(linhaItem(it, consulta)); };
  const info = h('div', { class: 'info', onclick: () => ficha(it) },
    h('div', {}, h('b', {}, it.id), ' ', h('span', { class: 'vol' }, it.vol || '—'),
      it.crate ? h('span', { class: 'meta' }, ` · crate ${it.crate}`) : null, it.nvol ? h('span', { class: 'meta' }, ` · vol ${it.nvol}`) : null,
      temDet && !S.det ? h('button', { class: 'lnk', 'data-det': it.id, 'aria-expanded': String(det), onclick: ev => { ev.stopPropagation(); S.detIt.has(it.id) ? S.detIt.delete(it.id) : S.detIt.add(it.id); troca(); } }, det ? 'ocultar ▴' : 'Detalhes ▾') : null),
    e.fora ? h('div', { class: 'tag-fora' }, `⊘ Fora do escopo: ${e.fora}${e.fora_obs ? ' – ' + e.fora_obs : ''}`) : null,
    e.diverg ? h('div', { class: 'tag-div' }, `⚠ Divergência: ${e.diverg}${e.diverg_obs ? ' – ' + e.diverg_obs : ''}`) : null,
    det ? h('div', { class: 'meta det' }, [it.peso ? `${it.peso} kg` : null, it.dim].filter(Boolean).join(' · ')) : null,
    h('div', { class: 'meta' }, [e.onde ? `📍 ${rotuloSala(salaPorId(e.onde)) || e.onde}` : (prevista(it) ? '📍 posição prevista (2016)' : null),
      e.enc ? `Encontrado: ${e.enc}` : null, e.estado || null, e.fotos.length ? `📷 ${e.fotos.length}` : null].filter(Boolean).join(' · ') || ' '));
  if (e.fora || e.diverg) { // fora do escopo / divergência: sem etapas, só o desfazer
    row.append(info, h('div', { class: 'etapas' }, h('button', { class: 'mini volta', onclick: async () => {
      if (e.fora) await marcarFora([it], ''); if (e.diverg) await marcarDiverg([it], ''); refrescar(); toast(`${it.id} de volta ao escopo`); } },
      e.diverg && !e.fora ? '↺ Foi encontrado' : '↺ Voltar ao escopo')));
    return row;
  }
  const bts = h('div', { class: 'etapas' });
  ETAPAS.forEach((nm, k) => {
    const na = k === 2 && !it.elev;
    bts.append(h('button', { class: 'et' + (e.c[k] ? ' on' : '') + (na ? ' na' : ''), disabled: na || consulta, title: nm, 'data-k': k,
      onclick: async () => { await toggleEtapa(it, k); troca(); } }, h('i', {}, k + 1), h('span', {}, nm)));
  });
  row.append(info, bts);
  return row;
}
async function conferirTodos(lst) {
  lst = ativos(lst);
  for (const it of lst) { const c = [...est(it.id).c]; if (!c[0]) { c[0] = 1; const e = { ...est(it.id), c, ts: Date.now() }; S.estado.set(it.id, e); await DB.put('estado', e); } }
  await log('lote', lst[0].tag, 'Conferido (todos)', lst.length);
  refrescar(); toast(`${lst.length} itens conferidos`);
}

// ---------- ficha do item ----------
function modal(content, aoFechar) {
  const m = $('#modal'); const novo = !m.classList.contains('on');
  m.innerHTML = ''; m.append(h('div', { class: 'mbox' }, content)); m.classList.add('on'); m._aoFechar = aoFechar || null;
  m.onclick = e => { if (e.target === m) fecharModal(); };
  if (novo) empilhar('modal', fecharModalJa);
}
function fecharModalJa() {
  const m = $('#modal'); const f = m._aoFechar; m._aoFechar = null;
  m.classList.remove('on'); m.innerHTML = ''; if (f) f(); if (S.seed) refrescar();
}
function fecharModal() { if (!desempilhar('modal')) fecharModalJa(); }
async function ficha(it) {
  const e = est(it.id);
  const sel = (nome, ops, val) => h('select', { name: nome }, h('option', { value: '' }, '—'), ops.map(o => h('option', { value: o, selected: o === val }, o)));
  const fotosBox = h('div', { class: 'thumbs' });
  for (const fid of e.fotos) { const f = await DB.get('fotos', fid); if (f) fotosBox.append(thumb(f)); }
  // "Onde está agora": se a ficha foi aberta fora da sala de origem do item, já vem com a sala atual (a confirmar ao salvar).
  // Lista: sala atual → salas recentes → locais do move-out → todas as salas; a busca filtra por código ou nome.
  const atual = idAtual() ? salaPorId(idAtual()) : null;
  const sug = atual && atual.tipo !== 'bloco' && !origemNa(it, atual) && e.onde !== atual.id && !e.fora && !e.diverg ? atual.id : '';
  const selOnde = h('select', { name: 'onde', id: 'selOnde' });
  const montaOnde = filtro => {
    const val = selOnde.options.length ? selOnde.value : (sug || e.onde || ''); const t = (filtro || '').trim().toLowerCase();
    const passa = rot => !t || rot.toLowerCase().includes(t); const usados = new Set();
    const ops = (lista, deSala) => lista.map(x => deSala ? [x.id, rotuloSala(x)] : [x, x]).filter(([v, rot]) => (passa(rot) || v === val) && !usados.has(v) && usados.add(v))
      .map(([v, rot]) => h('option', { value: v, selected: v === val }, rot));
    const grupo = (label, o) => (o.length ? h('optgroup', { label }, o) : null);
    const validas = pl => salasDe(pl).filter(x => x.tipo !== 'bloco' && (x.codigo !== '?' || x.tipo !== 'sala' || x.nome));
    const rec = (S.meta.recentes || []).filter(id => !atual || id !== atual.id).map(salaPorId).filter(x => x && x.tipo !== 'bloco');
    selOnde.innerHTML = '';
    selOnde.append(...[h('option', { value: '', selected: !val }, '— na sala de origem —'),
      grupo('Você está aqui', atual ? ops([atual], true) : []), grupo('Salas recentes', ops(rec, true)),
      grupo('Locais do move-out', ops(S.seed.locais, false)),
      ...Object.keys(S.seed.plantas).map(pl => grupo(S.seed.plantas[pl].nome, ops(validas(pl), true)))].filter(Boolean));
    if (val && ![...selOnde.options].some(o => o.value === val)) selOnde.append(h('option', { value: val, selected: true }, val));
    selOnde.value = val;
  };
  montaOnde('');
  const form = h('form', { class: 'ficha', onsubmit: async ev => {
    ev.preventDefault(); const fd = new FormData(form);
    const foraOn = !!fd.get('foraOn'); const motivo = foraOn ? (fd.get('motivo') || '') : ''; const fobs = foraOn ? (fd.get('fora_obs') || '') : '';
    if (foraOn && !motivo) { toast('Escolha o motivo de "fora do escopo"'); return; }
    // um só campo de comentário: na divergência ele é obrigatório e vale também como o comentário da divergência
    const divOn = !!fd.get('divOn'); const dmot = divOn ? (fd.get('dmotivo') || '') : ''; const dobs = divOn ? (fd.get('com') || '').trim() : '';
    if (divOn && (!dmot || !dobs || !(est(it.id).fotos || []).length)) { alert('Divergência exige motivo, comentário e pelo menos uma foto.'); return; }
    const patch = { enc: fd.get('enc') || '', estado: fd.get('estado') || '', onde: fd.get('onde') || '', com: fd.get('com') || '' };
    const ch = Object.keys(patch).filter(k => patch[k] !== (e[k] || ''));
    if (patch.enc === 'S' && !est(it.id).c[0] && !foraOn) patch.c = [1, ...est(it.id).c.slice(1)];
    if (ch.length || patch.c) await setEstado(it.id, patch, ch.join(',') || 'Conferido', ch.map(k => patch[k]).join(' | '));
    if (motivo !== (e.fora || '') || fobs !== (e.fora_obs || '')) await marcarFora([it], motivo, fobs);
    if (dmot !== (e.diverg || '') || dobs !== (e.diverg_obs || '')) await marcarDiverg([it], dmot, dobs);
    fecharModal(); toast(dmot && !e.diverg ? 'Divergência registrada' : motivo && !e.fora ? 'Item marcado fora do escopo' : (!motivo && e.fora) || (!dmot && e.diverg) ? 'Item de volta ao escopo' : 'Salvo');
  } },
    h('h2', {}, `${it.id} · ${it.tag}`),
    h('p', { class: 'sub' }, `${it.equip || ''} · ${it.vol || ''}${it.crate ? ' · crate ' + it.crate : ''} · origem ${it.sala}${it.peso ? ' · ' + it.peso + ' kg' : ''}${it.dim ? ' · ' + it.dim : ''}`),
    it.pos_fonte ? (prevista(it)
      ? h('p', { class: 'aviso-pos', id: 'avisoPos' }, '⚠ Posição prevista (layout 2016): nenhuma marcação de campo confirma onde este item está. Se achar em outro lugar, informe em "Onde está agora"; se não estiver no site, marque abaixo.')
      : h('p', { class: 'sub', id: 'avisoPos' }, `📍 Posição na planta: ${it.pos_fonte}`)) : null,
    h('div', { class: 'grid' },
      h('div', { class: 'fl' }, 'Encontrado', h('div', { class: 'seg' }, ['S', 'N', 'P'].map(v => h('label', {}, h('input', { type: 'radio', name: 'enc', value: v, checked: e.enc === v }), h('span', {}, { S: 'Sim', N: 'Não', P: 'Parcial' }[v]))))),
      h('label', {}, 'Estado', sel('estado', S.seed.estados, e.estado)),
      h('div', { class: 'fl full', id: 'campoOnde' }, 'Onde está agora',
        sug ? h('div', { class: 'aviso-onde', id: 'avisoOnde' }, h('b', {}, `Você está em ${rotuloSala(atual)} – confirmar?`), ' Ao salvar, o item fica registrado nesta sala. ',
          h('button', { type: 'button', class: 'mini', id: 'btnOndeOrigem', onclick: ev => { selOnde.value = ''; ev.target.closest('.aviso-onde').remove(); } }, 'Não: está na sala de origem')) : null,
        h('input', { type: 'search', id: 'buscaOnde', placeholder: 'Buscar sala (código ou nome)…', autocomplete: 'off', oninput: ev => montaOnde(ev.target.value) }), selOnde),
      h('label', { class: 'full', id: 'campoCom' }, 'Comentário', h('textarea', { name: 'com', id: 'fichaCom', rows: 3, placeholder: e.diverg ? 'onde procurou, quem confirmou…' : '' }, e.com || e.diverg_obs || ''))),
    h('fieldset', { class: 'escopo' + (e.fora ? ' on' : ''), id: 'escopo' },
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'foraOn', id: 'foraOn', checked: !!e.fora,
        onchange: ev => ev.target.closest('fieldset').classList.toggle('on', ev.target.checked) }), h('b', {}, '⊘ ' + ESC().rotulo_fora)),
      h('div', { class: 'grid escopo-det' },
        h('label', {}, 'Motivo', h('select', { name: 'motivo' }, h('option', { value: '' }, '—'), ESC().motivos_fora.map(m => h('option', { value: m, selected: m === e.fora }, m)))),
        h('label', {}, 'Documento / detalhe', h('input', { name: 'fora_obs', value: e.fora_obs || '', placeholder: 'ex.: retirado no lote 1 (NF 123)' }))),
      h('p', { class: 'sub' }, 'Só com motivo documentado. O item sai da planta e das pendências, mas fica na Lista, no histórico e no pacote do dia. Para desfazer, desmarque.')),
    h('fieldset', { class: 'escopo diverg' + (e.diverg ? ' on' : ''), id: 'divergencia' },
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'divOn', id: 'divOn', checked: !!e.diverg,
        onchange: ev => ev.target.closest('fieldset').classList.toggle('on', ev.target.checked) }), h('b', {}, '⚠ ' + ESC().rotulo_diverg + ' (divergência)')),
      h('div', { class: 'grid escopo-det' },
        h('label', {}, 'Motivo', h('select', { name: 'dmotivo', id: 'divMotivo' }, h('option', { value: '' }, '—'), ESC().motivos_diverg.map(m => h('option', { value: m, selected: m === e.diverg }, m))))),
      h('p', { class: 'sub' }, 'Exige o comentário (campo "Comentário" acima: onde procurou, quem confirmou) e pelo menos uma foto (abaixo). Conta como divergência no Resumo, no dashboard e na coluna Obs. da planilha.')),
    h('div', { class: 'fotos' }, h('b', {}, 'Fotos'), fotosBox,
      h('label', { class: 'btn' }, '📷 Tirar / escolher foto', h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, hidden: true, name: 'foto',
        onchange: async ev => { for (const f of ev.target.files) { const fo = await addFoto(f, it); fotosBox.append(thumb(fo)); } ev.target.value = ''; } }))),
    h('div', { class: 'acts' }, h('button', { type: 'button', onclick: fecharModal }, 'Cancelar'), h('button', { type: 'submit', class: 'primary' }, 'Salvar')));
  modal(form);
}
function thumb(f) { const u = URL.createObjectURL(f.blob); return h('figure', {}, h('img', { src: u, alt: f.nome }), h('figcaption', {}, f.id)); }
export async function comprimir(file, max = 1600, q = 0.75) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), hh = Math.round(bmp.height * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, hh);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
  return { blob, w, h: hh };
}
async function addFoto(file, it, salaOverride, extra) {
  const seq = (S.meta.ftSeq || 0) + 1; S.meta.ftSeq = seq; await DB.put('meta', seq, 'ftSeq');
  const { blob, w, h: hh } = await comprimir(file);
  const o = it && est(it.id).onde; const so = o && salaPorId(o);
  const sala = salaOverride || (it ? (so ? (so.codigo !== '?' ? so.codigo : so.id) : (o || it.sala)) : 'GERAL');
  const id = `FT-${String(seq).padStart(4, '0')}`;
  const deSala = it && String(it.id).startsWith('SALA:');
  const nome = nomeArq(deSala ? `${hoje()}_${slug(sala)}_SALA_${id}.jpg` : `${hoje()}_${slug(sala)}_${it ? it.id : 'SEMITEM'}_${it ? slug(it.tag) : 'GERAL'}_${id}.jpg`);
  const f = { id, item: it ? it.id : null, sala, nome, blob, w, h: hh, ts: Date.now(), exportado: 0, orig: file.name || '', ...(extra || {}) };
  await DB.put('fotos', f);
  if (f.reg) { const { blob: _b, ...m } = f; if (!S.fotosSala.has(f.sala_id)) S.fotosSala.set(f.sala_id, []); S.fotosSala.get(f.sala_id).push(m); }
  if (it) { const e = est(it.id); await setEstado(it.id, { fotos: [...e.fotos, id] }, 'foto', id); } else await log('foto', null, 'foto', id, { sala });
  return f;
}

// ---------- item novo ----------
function novoItem(sl) {
  const pl = sl.planta || S.planta;
  const nivel = pl === 'SL' ? 'L2' : (pl || '?');
  const form = h('form', { class: 'ficha', onsubmit: async ev => {
    ev.preventDefault(); const fd = new FormData(form);
    if (!fd.get('vol')) { toast('Descreva o item'); return; }
    const seq = (S.meta.novoSeq || 0) + 1; S.meta.novoSeq = seq; await DB.put('meta', seq, 'novoSeq');
    const id = `NOVO-${hoje()}-${String(seq).padStart(2, '0')}`;
    const tag = fd.get('tag') || 'NOVO';
    const eq = S.seed.equips.find(e => e.tag === tag);
    const it = { id, lote: eq ? eq.lote : '?', tag, equip: eq ? eq.nome : 'Não previsto', vol: fd.get('vol'), nvol: null, crate: null,
                 peso: null, dim: fd.get('dim') || null, nivel, sala: pl === 'SL' ? 'SALA LIMPA' : (sl.codigo !== '?' ? sl.codigo : sl.id),
                 rota: null, elev: nivel === 'L1' || nivel === 'L2' ? 1 : 0, novo: 1, planta_novo: pl };
    if (pl === 'SL') { if (sl.tipo === 'area') it.area = sl.id; else if (sl.tipo === 'marca') it.sub = sl.id; }
    else it.local = sl.id;
    await DB.put('novos', it); S.itens.push(it); S.byId.set(id, it);
    await setEstado(id, { enc: 'S', c: [1, 0, 0, 0, 0], com: fd.get('com') || '' }, 'novo', it.vol);
    const files = form.querySelector('input[type=file]').files;
    for (const f of files) await addFoto(f, it);
    fecharModal(); toast(`${id} criado`);
  } },
    h('h2', {}, `Item não previsto · ${rotuloSala(sl)}`),
    h('div', { class: 'grid' },
      h('label', {}, 'Equipamento (se souber)', h('select', { name: 'tag' }, h('option', { value: '' }, '— não sei —'), S.seed.equips.map(e => h('option', { value: e.tag }, `${e.tag} · ${e.nome}`)))),
      h('label', {}, 'Descrição do volume', h('input', { name: 'vol', placeholder: 'ex.: caixa de madeira sem identificação' })),
      h('label', {}, 'Dimensões / peso aprox.', h('input', { name: 'dim' })),
      h('label', { class: 'full' }, 'Comentário', h('textarea', { name: 'com', rows: 2 })),
      h('label', { class: 'btn full' }, '📷 Foto', h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true }))),
    h('div', { class: 'acts' }, h('button', { type: 'button', onclick: fecharModal }, 'Cancelar'), h('button', { type: 'submit', class: 'primary' }, 'Criar item')));
  modal(form);
}

// ---------- lista / busca ----------
function telaLista() {
  const box = h('div', { class: 'lista' });
  const q = h('input', { type: 'search', placeholder: 'Buscar CF-ID, tag, equipamento, volume…', value: S.q || '', id: 'busca' });
  const chips = h('div', { class: 'chips' });
  const salaSel = h('select', { id: 'fsala' }, h('option', { value: '' }, 'Todas as salas'), S.seed.salas.map(s => h('option', { value: s.id, selected: S.fs === s.id }, s.id)));
  const res = h('div', { class: 'res' });
  const go = () => {
    S.q = q.value; S.fs = salaSel.value; res.innerHTML = '';
    const t = S.q.trim().toLowerCase();
    const passa = i => S.fe == null ? true : S.fe === 'fora' ? foraEsc(i) : S.fe === 'div' ? divEsc(i) : S.fe === 'prev' ? prevista(i) && ativos([i]).length : ativos([i]).length && proxima(i) === S.fe;
    let l = S.itens.filter(i => (!S.fs || i.sala === S.fs) && passa(i) &&
      (!t || [i.id, i.tag, i.equip, i.vol, i.lote].some(v => String(v || '').toLowerCase().includes(t))));
    res.append(h('div', { class: 'sub', id: 'nres' }, `${l.length} itens`));
    for (const [tag, lst] of grupoPorEquip(l.slice(0, 400))) res.append(blocoEquip(tag, lst));
    if (S._rol) { $('#main').scrollTop = S._rol; S._rol = 0; }
  };
  const nFora = S.itens.filter(foraEsc).length, nDiv = S.itens.filter(divEsc).length, nPrev = ativos(S.itens).filter(prevista).length;
  [['Todas', null], ...PROX.map((p, k) => [p, k]), [`⚠ Divergências (${nDiv})`, 'div'], [`⊘ Fora do escopo (${nFora})`, 'fora'], [`Posição prevista 2016 (${nPrev})`, 'prev']]
    .forEach(([nm, k]) => chips.append(h('button', { class: 'chip' + (S.fe === k ? ' on' : ''), 'data-fe': k ?? 'todas', onclick: () => { S.fe = k; render(); } }, nm)));
  q.oninput = go; salaSel.onchange = go;
  box.append(h('div', { class: 'filtros' }, q, salaSel), chips, res); setTimeout(go);
  return box;
}

// ---------- equipamentos (ciclo 7): o equipamento inteiro, em qualquer sala ----------
function situacaoEquip(its) {
  const at = ativos(its); const nd = its.filter(divEsc).length;
  if (!at.length) return nd ? 'Com divergência' : 'Fora do escopo';
  if (at.every(i => proxima(i) === 5)) return 'Embarcado';
  if (at.some(i => proxima(i) > 1)) return 'Em movimento';
  if (at.every(i => est(i.id).c[0])) return 'Conferido';
  return at.some(i => est(i.id).c[0]) ? 'Conferência parcial' : 'A conferir';
}
function barraEtapas(its) {  // 5 etapas: fração dos volumes ativos com a etapa feita ("Desceu" só conta para quem usa o elevador)
  const at = ativos(its);
  return h('span', { class: 'etbar' }, ETAPAS.map((nm, k) => {
    const ap = at.filter(i => k !== 2 || i.elev); const ok = ap.filter(i => est(i.id).c[k]).length; const p = ap.length ? ok / ap.length : 0;
    return h('i', { title: `${nm}: ${ok}/${ap.length}`, class: ap.length ? '' : 'na', style: `--p:${Math.round(p * 100)}%;--c:${cor(p)}` }, k + 1);
  }));
}
function listaEquips() {
  const m = new Map(S.seed.equips.map(e => [e.tag, { ...e, its: [] }]));
  for (const it of S.itens) { if (!m.has(it.tag)) m.set(it.tag, { tag: it.tag, lote: it.lote, nome: it.equip, porte: '', its: [] }); m.get(it.tag).its.push(it); }
  return [...m.values()].filter(e => e.its.length).map(e => ({ ...e, loc: resumoLocais(e.its), sit: situacaoEquip(e.its), nd: e.its.filter(divEsc).length }));
}
function telaEquip() {
  const f = S.fq; const eqs = listaEquips();
  const box = h('div', { class: 'lista equips' });
  const uniq = l => [...new Set(l.filter(Boolean))].sort();
  const sel = (id, k, rot, ops) => h('select', { id, onchange: ev => { f[k] = ev.target.value; go(); } }, h('option', { value: '' }, rot), ops.map(o => h('option', { value: o, selected: f[k] === o }, o)));
  const q = h('input', { type: 'search', id: 'buscaEquip', placeholder: 'Buscar tag ou equipamento…', value: f.q || '', oninput: ev => { f.q = ev.target.value; go(); } });
  const res = h('div', { class: 'res', id: 'resEquip' });
  const go = () => {
    res.innerHTML = ''; const t = (f.q || '').trim().toLowerCase();
    const l = eqs.filter(e => (!t || [e.tag, e.nome, e.lote].some(v => String(v || '').toLowerCase().includes(t))) && (!f.lote || e.lote === f.lote) && (!f.porte || e.porte === f.porte)
      && (!f.sit || e.sit === f.sit || (f.sit === 'Com divergência' && e.nd)) && (!f.sala || e.loc.some(g => g.rot === f.sala)))
      .sort((a, b) => String(a.lote + a.tag).localeCompare(String(b.lote + b.tag)));
    res.append(h('div', { class: 'sub', id: 'nEquip' }, `${l.length} equipamento${l.length === 1 ? '' : 's'}`));
    for (const e of l) {
      const at = ativos(e.its);
      res.append(h('button', { class: 'eqrow', 'data-eq': e.tag, onclick: () => abrirEquip(e.tag) },
        h('span', { class: 'eq-id' }, h('b', {}, e.tag), h('span', { class: 'nm' }, ` ${e.nome || ''}`), h('small', {}, `${e.lote || ''}${e.porte ? ' · ' + e.porte : ''}`)),
        h('span', { class: 'eq-n' }, h('b', {}, `${conferidos(e.its)}/${at.length}`), h('small', {}, `conf. · ${e.its.length} vol.`)),
        barraEtapas(e.its),
        e.nd ? h('span', { class: 'tag-div' }, `⚠ ${e.nd}`) : null,
        h('span', { class: 'eq-salas' }, e.loc.map(g => h('span', { class: 'chipsala' }, `${g.rot}${e.loc.length > 1 ? ' ×' + g.n : ''}`)))));
    }
  };
  box.append(h('div', { class: 'filtros' }, q), h('div', { class: 'filtros sel' },
    sel('feLote', 'lote', 'Todos os lotes', uniq(eqs.map(e => e.lote))), sel('feSala', 'sala', 'Todas as salas', uniq(eqs.flatMap(e => e.loc.map(g => g.rot)))),
    sel('fePorte', 'porte', 'Todos os portes', uniq(eqs.map(e => e.porte))),
    sel('feSit', 'sit', 'Todas as situações', ['A conferir', 'Conferência parcial', 'Conferido', 'Em movimento', 'Embarcado', 'Com divergência', 'Fora do escopo'])), res);
  go();
  return box;
}
// vista do equipamento: camada por cima do que estiver aberto (aba Equipamentos ou painel da sala)
function abrirEquip(tag) {
  const novo = !S.eqSel; S.eqSel = tag;
  if (novo) empilhar('vista', fecharVistaJa);
  renderVista();
}
function fecharVistaJa() { S.eqSel = null; const v = $('#vista'); v.classList.remove('on'); v.innerHTML = ''; if (S.painel) renderPainel(); else render(); }
function fecharVista() { if (!desempilhar('vista')) fecharVistaJa(); }
function renderVista() {
  const tag = S.eqSel; const v = $('#vista'); if (!tag) return;
  const ant = v.querySelector('.pbody'); const rol = ant && v.dataset.tag === tag ? ant.scrollTop : 0; v.dataset.tag = tag;
  v.innerHTML = '';
  const its = itensDoEquip(tag); const eq = S.seed.equips.find(e => e.tag === tag) || {}; const at = ativos(its);
  const aqui = idAtual(); const sAqui = aqui ? salaPorId(aqui) : null;
  const peso = its.reduce((a, i) => a + (Number(i.peso) || 0), 0); const semPeso = its.filter(i => !i.peso).length;
  const head = h('div', { class: 'phead' },
    h('div', {}, h('button', { class: 'voltar', id: 'btnVoltarVista', onclick: fecharVista }, '← Voltar'),
      h('h2', {}, `${tag} · ${eq.nome || (its[0] || {}).equip || ''}`),
      h('div', { class: 'sub', id: 'vistaSub' }, [eq.lote || (its[0] || {}).lote, eq.porte, `${its.length} volume${its.length === 1 ? '' : 's'}`, `${conferidos(its)}/${at.length} conferidos`,
        peso ? `peso total ${peso.toLocaleString('pt-BR')} kg${semPeso ? ` (${semPeso} sem peso)` : ''}` : null,
        eq.dia_caminhao ? `🚚 ${eq.dia_caminhao.split('-').reverse().join('/')}` : null, eq.book ? `book ${eq.book}` : null].filter(Boolean).join(' · ')),
      h('div', { class: 'sub' }, barraEtapas(its), ` ${situacaoEquip(its)}`)),
    h('div', { class: 'pact' }, h('button', { class: 'x', onclick: fecharVista, 'aria-label': 'Fechar' }, '✕')));
  const body = h('div', { class: 'pbody' });
  body.append(h('p', { class: 'sub regra' }, sAqui ? `Você está em ${rotuloSala(sAqui)}: só os volumes desta sala podem ser marcados aqui. Os das outras salas aparecem para consulta.`
    : 'Conferência é presença física, sala a sala: os volumes aparecem para consulta. Abra a sala ("Ir para a sala") para marcar.'));
  for (const g of resumoLocais(its, aqui)) {
    const lst = its.filter(i => ondeEsta(i).k === g.k); const ehAqui = !!aqui && (g.k === aqui || (aqui === '__SL__' && g.s && g.s.planta === 'SL'));
    const sec = h('section', { class: 'grupo-sala' + (ehAqui ? ' aqui' : ''), 'data-local': g.k },
      h('div', { class: 'gs-head' }, h('b', {}, g.rot), h('span', { class: 'sub' }, ` ${lst.length} volume${lst.length === 1 ? '' : 's'}`),
        ehAqui ? h('span', { class: 'pill vist' }, 'você está aqui')
          : g.s ? h('button', { class: 'mini primary', 'data-ir': g.k, onclick: () => irParaSala(g.s, tag) }, 'Ir para a sala →') : h('span', { class: 'sub' }, ' (sem sala na planta)')));
    for (const it of lst) {
      const row = linhaItem(it, !ehAqui); const e = est(it.id); const o = salaOrigem(it);
      row.querySelector('.info').append(h('div', { class: 'meta orig' }, `origem ${o ? nomeLocal(o) : (it.sala || '—')} · agora ${g.rot}${g.informado ? ' (informado)' : ''} · ${PROX[proxima(it)]}`));
      if (e.fotos.length) { const tb = h('div', { class: 'thumbs mini-th' }); row.append(tb); for (const fid of e.fotos) DB.get('fotos', fid).then(fo => { if (fo) tb.append(thumb(fo)); }); }
      sec.append(row);
    }
    body.append(sec);
  }
  v.append(head, body); v.classList.add('on'); body.scrollTop = rol;
}
// "Ir para a sala": fecha a vista e abre o painel da sala com o filtro do equipamento
function irParaSala(s, q) {
  const pl = s.planta, pai = S.seed.plantas[pl] && S.seed.plantas[pl].pai;
  substituir([...(pai ? [{ tipo: 'planta', fechar: () => trocaPlanta(pai) }] : []), { tipo: 'painel', fechar: fecharPainelJa }]);
  S.view = 'planta'; S.edit = false; S.draw = null;
  if (S.planta !== pl) { S.planta = pl; S.zoom._nv = null; }
  S.filtro = { sala: s.id, q: q || '', pref: '' }; S.abertos = {}; S.painel = s;
  render(); entrouSala(s); renderPainel();
}

// ---------- resumo / fechar o dia ----------
function telaResumo() {
  const box = h('div', { class: 'resumo' });
  const porEtapa = PROX.map((_, k) => pendEtapa(S.itens, k));
  const nFora = S.itens.filter(foraEsc).length, nDiv = S.itens.filter(divEsc).length;
  const tbl = h('table', {}, h('tr', {}, h('th', {}, 'Sala'), h('th', {}, 'Itens'), h('th', {}, 'Conferidos'), h('th', {}, 'Progresso'), h('th', {}, 'Divergências'), h('th', {}, 'Fora do escopo')),
    S.seed.salas.map(s => { const l = S.itens.filter(i => i.sala === s.id); const p = progresso(l); const nf = l.filter(foraEsc).length; const nd = l.filter(divEsc).length;
      return h('tr', {}, h('td', {}, s.id), h('td', {}, ativos(l).length), h('td', {}, conferidos(l)), h('td', {}, h('span', { class: 'bar', style: `--p:${Math.round(p * 100)}%;--c:${cor(p)}` }), ` ${Math.round(p * 100)}%`), h('td', {}, nd || ''), h('td', {}, nf || '')); }));
  const est_ = h('span', { id: 'espaco' }, '…');
  navigator.storage?.estimate?.().then(e => { est_.textContent = `${(e.usage / 1e6).toFixed(1)} MB usados de ${(e.quota / 1e9).toFixed(1)} GB`; });
  const nome = h('input', { value: S.meta.conferente || '', placeholder: 'Nome do conferente', onchange: async ev => { S.meta.conferente = ev.target.value; await DB.put('meta', ev.target.value, 'conferente'); } });
  box.append(
    h('div', { class: 'cards' }, PROX.map((p, k) => h('div', { class: 'card', 'data-k': k, onclick: () => { S.fe = k; nav('lista'); } }, h('b', {}, porEtapa[k]), h('span', {}, p))),
      h('div', { class: 'card div', 'data-k': 'div', onclick: () => { S.fe = 'div'; nav('lista'); } }, h('b', {}, nDiv), h('span', {}, 'Divergências')),
      h('div', { class: 'card fora', 'data-k': 'fora', onclick: () => { S.fe = 'fora'; nav('lista'); } }, h('b', {}, nFora), h('span', {}, 'Fora do escopo'))),
    h('h3', {}, 'Por sala de origem'), tbl,
    h('h3', {}, 'Fechamento do dia'),
    h('p', {}, `Alterações desde o último fechamento: `, h('b', { id: 'pend' }, String(S.meta.pendentes || 0)), ` · último: ${S.meta.ultimoFechamento ? fmtD(S.meta.ultimoFechamento) : 'nunca'} · espaço: `, est_),
    h('div', { class: 'acts left' },
      h('button', { class: 'primary big', id: 'btnFechar', onclick: () => fecharDia(false) }, '⬇ Fechar o dia (pacote ZIP)'),
      h('button', { id: 'btnCompartilhar', onclick: compartilhar }, S.ultPac && !(S.meta.pendentes || 0) ? `📤 Compartilhar pacote (${S.ultPac.nome.replace(/^.*_(\d{8}-\d{4})\.zip$/, '$1')})` : '📤 Compartilhar pacote'),
      h('button', { onclick: () => fecharDia(true) }, 'Backup completo (todas as fotos)'),
      h('label', { class: 'btn' }, '↺ Restaurar backup', h('input', { type: 'file', id: 'inRestaurar', accept: ACEITA_PACOTE, hidden: true, onchange: async ev => {
        const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; try { await restaurar(f); } catch (x) { alert(x.message); } } })),
      h('label', { class: 'btn' }, 'Importar pacote de dados', h('input', { type: 'file', id: 'inImportar', accept: ACEITA_PACOTE, hidden: true, onchange: async ev => {
        const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
        try {
          if (S.salasEd.length) {
            const r = await perguntarEdicoes(S.salasEd.length); if (!r) return;
            if (r === 'pacote') { await DB.clear('salas'); await DB.put('meta', [], 'edHist'); await log('sistema', null, 'salas do pacote', `${S.salasEd.length} edições de sala descartadas`); }
            else await soltarContornosHerdados();
          }
          await importarArquivo(f); await carregar(); render(); toast('Dados atualizados – estado preservado');
        } catch (x) { alert(x.message); } } }))),
    h('h3', {}, 'Configuração'), h('label', {}, 'Conferente: ', nome),
    h('div', { class: 'acts left' }, h('button', { class: 'danger', id: 'btnZerar', onclick: zerarAparelho }, '🗑 Zerar dados deste aparelho')),
    h('p', { class: 'sub' }, `App v${APP_VERSION} · dados ${S.seed.versao} · ${S.itens.length} itens · ${S.seed.autoria}`));
  return box;
}
// "Manter minhas edições" (v1.3.2): a edição que NÃO mexeu na forma guardou uma cópia do contorno do pacote antigo. Antes de
// trocar o pacote, essa cópia sai – a sala passa a usar o contorno do pacote novo e continua com código, nome e "revisada".
// A edição que mexeu na forma (ou sala nova) fica como foi desenhada.
async function soltarContornosHerdados() {
  let n = 0;
  for (const e of [...S.salasEd]) {
    if (e.excluida || !e.poly) continue;
    const b = ((S.seed.plantas[e.planta] || {}).salas || []).find(x => x.id === e.id);
    if (!b || !(mesmoPoly(e.poly, b.poly) || mesmoPoly(e.poly, b.poly_antes))) continue;
    const { poly, label, poly_antes, area_m2, ...resto } = e; n++;
    const i = S.salasEd.findIndex(x => x.id === e.id); S.salasEd[i] = resto; await DB.put('salas', resto);
  }
  if (n) await log('sistema', null, 'salas do pacote', `${n} edição(ões) sem mudança de forma passam a usar o contorno do pacote novo`);
}
function perguntarEdicoes(n) {
  return new Promise(res => {
    const fim = v => { res(v); fecharModal(); };
    modal(h('div', { class: 'ficha', id: 'perguntaEdicoes' }, h('h2', {}, 'Salas editadas neste aparelho'),
      h('p', {}, `Há ${n} sala(s) editada(s) aqui (desenho, código, nome, revisão). O pacote novo traz as salas do escritório.`),
      h('p', { class: 'sub' }, 'As edições já foram junto em cada "Fechar o dia" (salas_editadas.json). O estado dos itens e as fotos não mudam.'),
      h('div', { class: 'acts' }, h('button', { type: 'button', onclick: () => fim(null) }, 'Cancelar'),
        h('button', { type: 'button', id: 'btnUsarPacote', onclick: () => fim('pacote') }, 'Usar as salas do pacote'),
        h('button', { type: 'button', class: 'primary', id: 'btnManterEd', onclick: () => fim('manter') }, 'Manter minhas edições'))), () => res(null));
  });
}
// restaurar: BACKUP_*.zip (tudo) ou o último pacote do dia (estado completo + fotos daquele dia) → estado, fotos, salas editadas, itens novos
async function restaurar(file) {
  if (!S.seed) throw new Error('Carregue primeiro o pacote de dados (o backup traz o estado, não as plantas).');
  const z = await readZip(file); const td = n => z[n] ? JSON.parse(new TextDecoder().decode(z[n])) : null;
  const meta = td('meta.json'), estado = td('estado.json');
  if (!meta || !estado) throw new Error('Este ZIP não é um backup nem um pacote do dia do App de Campo');
  if (!!meta.demo !== !!S.seed.demo) throw new Error(meta.demo ? 'Este arquivo é de DEMONSTRAÇÃO: não entra num aparelho com o pacote oficial.' : 'Este aparelho está com o pacote de DEMONSTRAÇÃO: não recebe backup do controle.');
  const fotosM = td('fotos.json') || [], salas = td('salas_editadas.json') || [], novos = td('novos.json') || [], eventos = td('eventos.json') || [];
  const comBlob = fotosM.filter(f => z['fotos/' + f.nome]);
  const ok = await new Promise(res => {
    const fim = v => { res(v); fecharModal(); };
    modal(h('div', { class: 'ficha', id: 'confRestaurar' }, h('h2', {}, `Restaurar ${meta.completo ? 'backup completo' : 'pacote do dia'}`),
      h('p', {}, `${file.name} · gerado em ${fmtD(meta.gerado)} · conferente ${meta.conferente || '—'} · dados ${meta.seed}`),
      h('ul', {}, h('li', {}, `${estado.length} itens com estado (substitui o estado deste aparelho)`), h('li', {}, `${comBlob.length} fotos`),
        h('li', {}, `${salas.length} salas editadas`), h('li', {}, `${novos.length} itens não previstos`)),
      meta.seed !== S.seed.versao ? h('p', { class: 'aviso-pos' }, `⚠ O backup foi feito com outro pacote de dados (${meta.seed}); o deste aparelho é ${S.seed.versao}.`) : null,
      !meta.completo ? h('p', { class: 'sub' }, 'Pacote do dia: traz o estado completo, mas só as fotos daquele dia. Para trazer todas as fotos, use um BACKUP_*.zip.') : null,
      h('p', { class: 'sub' }, 'O que foi feito neste aparelho depois desse arquivo se perde.'),
      h('div', { class: 'acts' }, h('button', { type: 'button', onclick: () => fim(false) }, 'Cancelar'),
        h('button', { type: 'button', class: 'primary', id: 'btnRestaurarOk', onclick: () => fim(true) }, 'Restaurar'))), () => res(false));
  });
  if (!ok) return;
  await DB.clear('estado'); await DB.clear('salas');
  for (const { onde_label, ...e } of estado) await DB.put('estado', e);
  for (const f of comBlob) await DB.put('fotos', { ...f, nome: nomeFoto(f.nome), blob: new Blob([z['fotos/' + f.nome]], { type: 'image/jpeg' }), exportado: 1 });
  for (const s_ of salas) await DB.put('salas', s_);
  for (const n of novos) await DB.put('novos', n);
  for (const { seq, ...ev } of eventos) await DB.put('eventos', { ...ev, exportado: 1 });
  const maxN = (l, rx) => l.reduce((m, x) => { const r = rx.exec(x.id || ''); return r ? Math.max(m, +r[1]) : m; }, 0);
  S.meta.ftSeq = Math.max(S.meta.ftSeq || 0, maxN(fotosM, /^FT-(\d+)/)); await DB.put('meta', S.meta.ftSeq, 'ftSeq');
  S.meta.novoSeq = Math.max(S.meta.novoSeq || 0, maxN(novos, /-(\d+)$/)); await DB.put('meta', S.meta.novoSeq, 'novoSeq');
  if (meta.conferente) await DB.put('meta', meta.conferente, 'conferente');
  await DB.put('meta', 0, 'pendentes'); await DB.put('meta', null, 'pendDesde'); await DB.put('meta', Date.parse(meta.gerado) || Date.now(), 'ultimoFechamento');
  await DB.put('eventos', { ts: Date.now(), tipo: 'sistema', id: null, campo: 'restaurado', valor: `${file.name} (${estado.length} estados, ${comBlob.length} fotos)`, exportado: 0 });
  await carregar(); render(); toast(`Restaurado: ${estado.length} estados, ${comBlob.length} fotos, ${salas.length} salas editadas`);
}
function avisoSemFechar() {
  const p = S.meta.pendentes || 0, d = S.meta.pendDesde;
  if (!p || !d || Date.now() - d < 4 * 3600e3) return;
  const horas = Math.floor((Date.now() - d) / 3600e3);
  modal(h('div', { class: 'ficha', id: 'avisoFechar' }, h('h2', {}, '⚠ Alterações sem "Fechar o dia"'),
    h('p', {}, `Há ${p} alteração(ões) feitas há mais de ${horas} h que ainda não foram para um pacote do dia (é também o backup).`),
    h('div', { class: 'acts' }, h('button', { type: 'button', onclick: fecharModal }, 'Depois'),
      h('button', { type: 'button', class: 'primary', id: 'btnFecharAgora', onclick: async () => { fecharModal(); await fecharDia(false); } }, '⬇ Fechar o dia agora'))));
}
async function zerarAparelho() {
  const p = S.meta.pendentes || 0;
  if (p && !confirm(`Há ${p} alteração(ões) que ainda não foram para um pacote do dia.\n\nFaça "Fechar o dia" antes. Continuar mesmo assim e PERDER essas alterações?`)) return;
  if (!confirm('1/2 – Apagar TODOS os dados deste aparelho: estado dos itens, fotos, edições de salas, histórico e o pacote de dados?')) return;
  if (!confirm('2/2 – Confirma? Isto não pode ser desfeito.')) return;
  for (const st of (DB.STORE_NAMES || ['meta', 'estado', 'fotos', 'eventos', 'novos', 'arquivos', 'salas'])) await DB.clear(st);
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('appcampo.')) localStorage.removeItem(k); } catch { /* sem armazenamento */ }
  location.reload();
}
export async function montarPacote(completo) {
  const fotos = (await DB.all('fotos')).filter(f => completo || !f.exportado).map(f => ({ ...f, nome: nomeFoto(f.nome) }));  // pacotes antigos: "SALA:" no nome
  const eventos = (await DB.all('eventos')).filter(e => completo || !e.exportado);
  const estado = [...S.estado.values()].filter(e => e.ts);
  // janelas de sala: "vistoria" (ciclo 7: da 1ª à última ação) ou "inspecao" (ciclo 8: da abertura do painel à saída)
  const vist = (await DB.all('eventos')).filter(e => e.tipo === 'vistoria').map(e => (e.modo === 'inspecao' ? { ...e, tipo: 'inspecao' } : e));
  // registros das fotos de sala: sempre todos (comentário, equipamento e ponto podem ser editados depois do dia da foto)
  const fotosSala = (await DB.all('fotos')).filter(f => f.reg).map(({ blob, ...r }) => ({ ...r, nome: nomeFoto(r.nome) }));
  const agora = new Date();
  const meta = { app: APP_VERSION, seed: S.seed.versao, gerado: agora.toISOString(), conferente: S.meta.conferente || '', completo: !!completo,
                 n_itens: S.itens.length, n_estado: estado.length, n_eventos: eventos.length, n_fotos: fotos.length, n_fotos_sala: fotosSala.length,
                 n_inspecao: vist.filter(e => e.tipo === 'inspecao').length };
  const demo = !!S.seed.demo;  // pacote de demonstração: marcado no nome e no conteúdo; o escritório recusa a importação
  if (demo) { meta.demo = true; meta.aviso = 'DEMONSTRAÇÃO – não entra no controle'; }
  const novos = await DB.all('novos');
  const foraL = S.itens.filter(foraEsc).map(i => ({ id: i.id, tag: i.tag, sala: i.sala, vol: i.vol, fora: est(i.id).fora, fora_obs: est(i.id).fora_obs || '', ts: est(i.id).ts }));
  meta.n_fora = foraL.length;
  const divL = S.itens.filter(divEsc).map(i => ({ id: i.id, tag: i.tag, sala: i.sala, vol: i.vol, diverg: est(i.id).diverg, diverg_obs: est(i.id).diverg_obs || '', fotos: est(i.id).fotos || [], ts: est(i.id).ts }));
  meta.n_diverg = divL.length;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const porEtapa = PROX.map((p, k) => `<tr><td>${p}</td><td>${pendEtapa(S.itens, k)}</td></tr>`).join('');
  const resumo = `<!DOCTYPE html><meta charset="utf-8"><title>Resumo do dia</title><body style="font-family:Arial">
${demo ? '<p style="background:#c62828;color:#fff;padding:8px;font-weight:bold">DEMONSTRAÇÃO – o que foi registrado aqui não entra no controle</p>' : ''}
<h2>${esc(S.seed.projeto || 'Move-out')} – resumo do dia ${agora.toLocaleDateString('pt-BR')}</h2><p>${esc(S.seed.autoria)} · conferente ${esc(meta.conferente || '—')}</p>
<p>${eventos.length} alterações · ${fotos.length} fotos · ${novos.length} itens não previstos · ${divL.length} divergências · ${foraL.length} fora do escopo</p><table border=1 cellpadding=4>${porEtapa}</table>
${divL.length ? `<h3>Divergências – ${esc(ESC().rotulo_diverg)} (${divL.length})</h3><ul>${divL.map(f => `<li><b>${esc(f.id)}</b> ${esc(f.tag)} · ${esc(f.vol)} – ${esc(f.diverg)} – ${esc(f.diverg_obs)} (${f.fotos.length} foto)</li>`).join('')}</ul>` : ''}
${foraL.length ? `<h3>${esc(ESC().rotulo_fora)} (${foraL.length})</h3><ul>${foraL.map(f => `<li><b>${esc(f.id)}</b> ${esc(f.tag)} · ${esc(f.vol)} – ${esc(f.fora)}${f.fora_obs ? ' – ' + esc(f.fora_obs) : ''}</li>`).join('')}</ul>` : ''}</body>`;
  const files = [
    { name: 'meta.json', data: JSON.stringify(meta, null, 1) },
    { name: 'fora_escopo.json', data: JSON.stringify(foraL) },
    { name: 'divergencias.json', data: JSON.stringify(divL) },
    { name: 'estado.json', data: JSON.stringify(estado.map(({ fotos, ...r }) => ({ ...r, fotos, onde_label: r.onde ? (rotuloSala(salaPorId(r.onde)) || r.onde) : '' })), null, 0) },
    { name: 'salas_editadas.json', data: JSON.stringify(S.salasEd) },
    { name: 'eventos.json', data: JSON.stringify(eventos) },
    { name: 'novos.json', data: JSON.stringify(novos) },
    { name: 'vistorias.json', data: JSON.stringify(vist) },
    { name: 'fotos_sala.json', data: JSON.stringify(fotosSala) },
    { name: 'fotos.json', data: JSON.stringify(fotos.map(({ blob, ...r }) => r)) },
    { name: 'resumo.html', data: resumo },
    ...fotos.map(f => ({ name: 'fotos/' + f.nome, data: f.blob })),
  ];
  const zip = await makeZip(files);
  const stamp = `${hoje()}-${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}`;
  return { zip, nome: `${completo ? 'BACKUP' : 'PACOTE'}${demo ? '_DEMO' : ''}_AppCampo_L2_${stamp}.zip`, fotos, eventos, meta };
}
async function fecharDia(completo) {
  if (!S.meta.conferente) await pedirConferente('O pacote do dia leva o nome de quem conferiu.');
  await encerrarVistoria();  // fechar o dia fecha a janela da sala atual
  const { zip, nome, fotos: fotosP, eventos } = await montarPacote(completo);
  const ids = new Set(fotosP.map(f => f.id)); const fotos = (await DB.all('fotos')).filter(f => ids.has(f.id));
  baixar(zip, nome); S.ultPac = { zip, nome };  // o pacote sempre é baixado; "Compartilhar pacote" manda o mesmo arquivo a outro app
  for (const f of fotos) { f.exportado = 1; f.nome = nomeFoto(f.nome); await DB.put('fotos', f); }
  for (const e of eventos) { e.exportado = 1; await DB.put('eventos', e); }
  S.meta.pendentes = 0; S.meta.ultimoFechamento = Date.now(); S.meta.pendDesde = null;
  await DB.put('meta', 0, 'pendentes'); await DB.put('meta', S.meta.ultimoFechamento, 'ultimoFechamento'); await DB.put('meta', null, 'pendDesde');
  window.__ULTIMO_PACOTE__ = { nome, size: zip.size };
  render(); toast(`${nome} gerado (${(zip.size / 1e6).toFixed(1)} MB)${S.meta.conferente ? '' : ' – ATENÇÃO: sem nome do conferente'}`);
}

function baixar(zip, nome) { const a = h('a', { href: URL.createObjectURL(zip), download: nome }); document.body.append(a); a.click(); a.remove(); }
// "Compartilhar pacote": folha de compartilhamento do aparelho com o ZIP (para o app de nuvem). Se ainda não há pacote desta
// sessão, ou há alterações novas, fecha o dia antes (o pacote também é baixado). Navegador que não compartilha arquivos: só o download.
async function compartilhar() {
  const novo = !S.ultPac || (S.meta.pendentes || 0) > 0;
  if (novo) await fecharDia(false);
  const { zip, nome } = S.ultPac; const file = new File([zip], nome, { type: 'application/zip' });
  if (!(navigator.canShare && navigator.canShare({ files: [file] }))) {
    if (!novo) baixar(zip, nome);
    toast('Este navegador não compartilha este tipo de arquivo – o pacote foi baixado (pasta de downloads)'); return 'download';
  }
  try { await navigator.share({ files: [file], title: nome }); toast('Pacote entregue ao compartilhamento'); return 'share'; }
  catch (x) {
    // cancelado, ou o navegador recusou (pede um toque logo antes de abrir a folha, ou não aceita este tipo de arquivo): o pacote já foi baixado
    toast(x && x.name === 'AbortError' ? 'Compartilhamento cancelado – o pacote está na pasta de downloads'
      : 'O compartilhamento não abriu – o pacote está na pasta de downloads; toque de novo em "Compartilhar pacote" para tentar outra vez');
    return 'pendente';
  }
}

// ---------- inicialização ----------
function telaSemDados() {
  const main = $('#main'); main.innerHTML = '';
  const inp = h('input', { type: 'file', accept: ACEITA_PACOTE, id: 'seedfile', onchange: async ev => {
    try { await importarArquivo(ev.target.files[0]); await iniciar(); } catch (x) { alert('Erro: ' + x.message); } } });
  const box = h('div', { class: 'boas' }, h('h2', {}, 'Bem-vindo ao App de Campo'),
    h('p', {}, 'Para começar, carregue o pacote de dados (arquivo .zip gerado pela Miana: itens, equipamentos e plantas). Os dados ficam só neste aparelho.'),
    h('label', { class: 'btn primary big' }, 'Selecionar pacote de dados', inp),
    h('button', { id: 'btnIncluidos', onclick: async () => {
      try { const r = await fetch('data/seed.json', { cache: 'no-store' }); if (!r.ok) throw new Error('sem dados incluídos');
        await importarSeed(await r.json()); await iniciar(); } catch (x) { alert(x.message); } } }, 'Usar dados incluídos (instalação de teste)'));
  // na versão publicada não há data/seed.json: o botão só aparece no servidor local (ou na visualização, com dados embutidos)
  const btn = box.querySelector('#btnIncluidos'); btn.hidden = !window.__SEED__;
  if (!window.__SEED__) fetch('data/seed.json', { method: 'HEAD', cache: 'no-store' }).then(r => { btn.hidden = !r.ok; }).catch(() => { btn.hidden = true; });
  main.append(box);
}
export async function iniciar() {
  try { await navigator.storage?.persist?.(); } catch (_) { }
  const ok = await carregar();
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    const v = b.dataset.v; if (!S.seed) return;
    if (S.seed.plantas[v]) { substituir([]); S.planta = v; S.view = 'planta'; S.zoom._nv = null; S.edit = false; S.draw = null; render(); }
    else nav(v);
  });
  if (!ok) { telaSemDados(); return; }
  const bp = $('#brandProj'); if (bp) bp.textContent = S.seed.projeto || 'App de Campo'; document.title = `App de Campo · ${S.seed.projeto || ''}`;
  S.meta.edHist = ((await DB.get('meta', 'edHist')) || []).length;
  // recarregou no meio de uma pilha de camadas: volta o histórico até a guarda
  if (history.state && history.state.appcampo) { NAV.guarda = true; if (history.state.d > 0) recuar(history.state.d); }
  clearInterval(S._tique); S._tique = setInterval(tique, 15e3);
  render();
  if (!S.meta.conferente) pedirConferente(); else setTimeout(avisoSemFechar, 300);
}
// nome do conferente: pedido na primeira abertura (dá para trocar no Resumo); pacote sem conferente sai com aviso
function pedirConferente(motivo) {
  return new Promise(res => {
    const inp = h('input', { id: 'inConferente', name: 'nome', placeholder: 'Seu nome', autocomplete: 'name', value: S.meta.conferente || '' });
    const form = h('form', { class: 'ficha', id: 'pedeConferente', onsubmit: async ev => {
      ev.preventDefault(); const v = inp.value.trim(); if (!v) { toast('Informe o nome'); return; }
      S.meta.conferente = v; await DB.put('meta', v, 'conferente'); fecharModal(); toast(`Conferente: ${v}`);
    } }, h('h2', {}, 'Quem está conferindo?'),
      h('p', { class: 'sub' }, `${motivo ? motivo + ' ' : ''}O nome vai em cada pacote do dia. Dá para trocar depois, no Resumo.`),
      h('div', { class: 'grid' }, h('label', { class: 'full' }, 'Nome do conferente', inp)),
      h('div', { class: 'acts' }, h('button', { type: 'button', id: 'btnConferenteDepois', onclick: fecharModal }, 'Depois'), h('button', { type: 'submit', class: 'primary', id: 'btnConferente' }, 'Salvar')));
    modal(form, () => res(S.meta.conferente || ''));
  });
}
// atalho para os testes: abre a edição de forma de uma sala (o mesmo que ficha da sala → "Editar forma")
function editarForma(id) { const s = salasDe(S.planta).find(x => x.id === id); if (!s) return false; S.edit = true; S.draw = null; S.edModo = 'vertices'; S.edTmp = { sala: s, poly: s.poly.map(p => [...p]) }; render(); return true; }
window.__APP__ = { S, NAV, est, proxima, montarPacote, DB, salasDe, distSeg, pxPorMetro, editarForma, abrirSala, salaPorId, abrirEquip, ondeEsta, encerrarVistoria, tique, nomeArq, nomeFoto, importarSeed,
  inspLigada, alternarInspecao, telaAbertura, telaCalibrar, fotosDaSala, addFotoSala, editarFoto, compartilhar, lembretes, isoLocal, qrSvg };
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
iniciar();
