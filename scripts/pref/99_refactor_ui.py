"""
Refatora o bloco PREFEITURAS no index.html para UI de 3 camadas
(Estado -> Cidade -> Convenio -> Detalhes), e refatora o bloco GOVERNOS
para 3 camadas (Estado -> Convenio -> Detalhes).

Tambem remove referencias 'pode levar X' das mensagens de loading.

Salva index.html in-place. Re-rodavel.
"""
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent.parent.parent
HTML = ROOT / 'index.html'

src = HTML.read_text(encoding='utf-8')
orig_size = len(src)

# ──────────────────────────────────────────────────────────────────
# 1) PREFEITURAS — substitui prefState + funcoes + renderPrefCatalogo + renderPrefConvenioDetalhe
# ──────────────────────────────────────────────────────────────────

# Marcador de inicio: o `let prefState = {`
# Marcador de fim: o cabecalho "// ── Render: Análise de Holerite (Prefeituras)"
PREF_BLOCK_RE = re.compile(
    r"let prefState = \{[\s\S]*?// .. Render: An.lise de Holerite \(Prefeituras\)"
)

PREF_NEW_BLOCK = r'''let prefState = {
  loadingCat: false, todosConvenios: null, errCat: null,
  carregouUmaVez: false,
  filtroBusca: '', filtroTipo: '',
  ufAberta: null,            // ex: 'SP' (camada 2 ativa)
  cidadeAberta: null,        // ex: 'SOROCABA' (camada 3 ativa)
  convenioAberto: null,      // {convenio, bancos} (camada 4 ativa)
  bancoExpandido: null,
  arquivoBase64: null, arquivoNome: null, arquivoTipo: null, arquivoTamanho: 0,
  loadingHol: false, errHol: null, resultadoHol: null,
  convenioForcadoSlug: '',
};

async function prefCarregarConvenios(){
  prefState.loadingCat = true; prefState.errCat = null; renderApp();
  try{
    // Carrega TODOS de uma vez (sem filtro server-side); filtro/agrupamento eh client-side
    const r = await apiFetch('/api/pref',{method:'POST',body:JSON.stringify({action:'listConvenios'})});
    if(r.status === 404){ throw new Error('Endpoint /api/pref nao existe — falta git push do api/pref.js'); }
    const d = await r.json();
    if(!d.ok) throw new Error(d.error||'Falha');
    prefState.todosConvenios = d.convenios || [];
  }catch(e){ prefState.errCat = e.message; }
  prefState.loadingCat = false;
  prefState.carregouUmaVez = true;
  renderApp();
}

function prefAbrirUf(uf){ prefState.ufAberta = uf; prefState.cidadeAberta = null; prefState.convenioAberto = null; renderApp(); }
function prefVoltarParaUfs(){ prefState.ufAberta = null; prefState.cidadeAberta = null; prefState.convenioAberto = null; renderApp(); }
function prefAbrirCidade(municipio){ prefState.cidadeAberta = municipio; prefState.convenioAberto = null; renderApp(); }
function prefVoltarParaCidades(){ prefState.cidadeAberta = null; prefState.convenioAberto = null; renderApp(); }

async function prefAbrirConvenio(slug){
  prefState.convenioAberto = { loading: true };
  renderApp();
  try{
    const r = await apiFetch('/api/pref',{method:'POST',body:JSON.stringify({action:'getConvenio', slug})});
    const d = await r.json();
    if(!d.ok) throw new Error(d.error||'Falha');
    prefState.convenioAberto = { convenio: d.convenio, bancos: d.bancos };
  }catch(e){ prefState.convenioAberto = { error: e.message }; }
  prefState.bancoExpandido = null;
  renderApp();
}

function prefFecharConvenio(){ prefState.convenioAberto = null; prefState.bancoExpandido = null; renderApp(); }

function prefToggleBanco(id){
  prefState.bancoExpandido = prefState.bancoExpandido === id ? null : id;
  renderApp();
}

// ── Helpers de agrupamento (UF -> Cidade -> Convenios) ────────
function prefAgruparPorUfCidade(){
  const lista = prefState.todosConvenios || [];
  const norm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const q = norm(prefState.filtroBusca || '').trim();
  const tFilter = prefState.filtroTipo || '';
  const filtrados = lista.filter(c => {
    if(tFilter && c.tipo !== tFilter) return false;
    if(!q) return true;
    return norm(c.nome).includes(q) || norm(c.municipio||'').includes(q)
        || norm(c.sheet_origem||'').includes(q) || norm(c.uf||'').includes(q);
  });
  const ufs = {};
  for(const c of filtrados){
    const uf = c.uf || 'OUTROS';
    if(!ufs[uf]) ufs[uf] = { uf, estado_nome: c.estado_nome, cidades:{}, total:0 };
    const muni = (c.municipio||'(sem cidade)').toString();
    if(!ufs[uf].cidades[muni]) ufs[uf].cidades[muni] = { municipio: muni, convenios:[] };
    ufs[uf].cidades[muni].convenios.push(c);
    ufs[uf].total++;
  }
  return Object.values(ufs).sort((a,b)=>(a.uf||'ZZ').localeCompare(b.uf||'ZZ'));
}

function _prefTipoIcon(t){ return t==='prefeitura'?'🏛️':t==='instituto_previdencia'?'📋':t==='cartao_beneficio'?'💳':'🏙️'; }
function _prefTipoLabel(t){ return t==='prefeitura'?'Prefeitura':t==='instituto_previdencia'?'Instituto de Previdência':t==='cartao_beneficio'?'Cartão Benefício':'Convênio'; }

// ── Render: Catalogo (3 camadas: Estado -> Cidade -> Convenio -> Detalhe) ──
function renderPrefCatalogo(){
  if(!prefState.carregouUmaVez && !prefState.loadingCat){ prefCarregarConvenios(); }
  if(prefState.convenioAberto) return renderPrefConvenioDetalhe();
  if(prefState.cidadeAberta) return renderPrefCidadeConvenios();
  if(prefState.ufAberta) return renderPrefUfCidades();
  return renderPrefEstados();
}

// Header com filtros (busca + tipo) — aparece em todas as camadas
function _prefHeaderFiltros(){
  let h = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;align-items:center">';
  h += `<input class="form-input" placeholder="🔍 Buscar (cidade, instituto, ex: Sorocaba, IPREM, Campinas)..." value="${esc(prefState.filtroBusca)}" oninput="prefState.filtroBusca=this.value;renderApp()" style="flex:2;min-width:240px">`;
  h += `<select class="form-input" onchange="prefState.filtroTipo=this.value;renderApp()" style="flex:0 0 200px">
    <option value="">Todos os tipos</option>
    <option value="prefeitura" ${prefState.filtroTipo==='prefeitura'?'selected':''}>🏛️ Prefeitura</option>
    <option value="instituto_previdencia" ${prefState.filtroTipo==='instituto_previdencia'?'selected':''}>📋 Instituto Prev.</option>
    <option value="cartao_beneficio" ${prefState.filtroTipo==='cartao_beneficio'?'selected':''}>💳 Cartão Benefício</option>
  </select>`;
  h += '</div>';
  return h;
}

// Camada 1: lista de Estados (UFs)
function renderPrefEstados(){
  let h = '<div style="max-width:1100px;margin:0 auto;padding:24px">';
  h += '<div style="font-size:22px;font-weight:800;margin-bottom:6px">🏙️ Catálogo de Prefeituras</div>';
  h += '<div style="font-size:13px;color:var(--t2);margin-bottom:20px">Escolha um estado para ver as cidades disponíveis.</div>';
  h += _prefHeaderFiltros();

  if(prefState.loadingCat){ h += '<div style="padding:40px;text-align:center;color:var(--t2)">⏳ Carregando…</div></div>'; return h; }
  if(prefState.errCat){
    h += `<div style="padding:14px;background:rgba(239,68,68,.1);border:1px solid var(--red);border-radius:10px;color:var(--red);margin-bottom:12px">❌ ${esc(prefState.errCat)}</div>`;
    h += `<div style="text-align:center"><button class="btn-acc" onclick="prefState.carregouUmaVez=false;prefCarregarConvenios()">🔄 Tentar de novo</button></div></div>`;
    return h;
  }
  const ufs = prefAgruparPorUfCidade();
  if(ufs.length === 0){
    h += '<div style="padding:40px;text-align:center;color:var(--t3)">Nenhum convênio encontrado.</div></div>'; return h;
  }
  const totalConv = ufs.reduce((s,u)=>s+u.total,0);
  const totalCid = ufs.reduce((s,u)=>s+Object.keys(u.cidades).length,0);
  h += `<div style="font-size:12px;color:var(--t3);margin-bottom:14px">${ufs.length} estado(s) · ${totalCid} cidade(s) · ${totalConv} convênio(s)</div>`;
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">';
  for(const u of ufs){
    const ncid = Object.keys(u.cidades).length;
    h += `<div onclick="prefAbrirUf('${esc(u.uf)}')" style="background:var(--card);border:1px solid var(--brd);border-radius:12px;padding:18px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--acc)';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--brd)';this.style.transform='translateY(0)'">`;
    h += `<div style="font-size:28px;font-weight:900;color:var(--acc);line-height:1">${esc(u.uf)}</div>`;
    h += `<div style="font-size:13px;color:var(--t2);margin-top:4px">${esc(u.estado_nome||'')}</div>`;
    h += `<div style="font-size:12px;color:var(--t3);margin-top:8px">📍 ${ncid} cidade(s) · ${u.total} convênio(s)</div>`;
    h += `</div>`;
  }
  h += '</div></div>';
  return h;
}

// Camada 2: lista de Cidades dentro do Estado
function renderPrefUfCidades(){
  const uf = prefState.ufAberta;
  const ufs = prefAgruparPorUfCidade();
  const grupo = ufs.find(g => g.uf === uf);
  let h = '<div style="max-width:1100px;margin:0 auto;padding:24px">';
  h += `<div style="margin-bottom:14px;display:flex;gap:8px;align-items:center;font-size:12px;color:var(--t3)">
    <a onclick="prefVoltarParaUfs()" style="cursor:pointer;color:var(--acc)">🏙️ Estados</a>
    <span>›</span>
    <span style="color:var(--t1);font-weight:700">${esc(uf)}${grupo&&grupo.estado_nome?' · '+esc(grupo.estado_nome):''}</span>
  </div>`;
  h += `<div style="font-size:22px;font-weight:800;margin-bottom:6px">${esc(grupo?grupo.estado_nome:uf)} <span style="color:var(--t3);font-weight:400;font-size:14px">(${esc(uf)})</span></div>`;
  h += '<div style="font-size:13px;color:var(--t2);margin-bottom:20px">Escolha uma cidade para ver os convênios disponíveis.</div>';
  h += _prefHeaderFiltros();

  if(!grupo || Object.keys(grupo.cidades).length===0){
    h += '<div style="padding:40px;text-align:center;color:var(--t3)">Nenhuma cidade encontrada com esse filtro.</div></div>'; return h;
  }
  const cidades = Object.values(grupo.cidades).sort((a,b)=>a.municipio.localeCompare(b.municipio,'pt-BR'));
  h += `<div style="font-size:12px;color:var(--t3);margin-bottom:14px">${cidades.length} cidade(s) com ${grupo.total} convênio(s)</div>`;
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">';
  for(const cid of cidades){
    const tipos = {};
    for(const c of cid.convenios){ tipos[c.tipo] = (tipos[c.tipo]||0)+1; }
    let badges = '';
    if(tipos.prefeitura) badges += `<span class="pill" style="background:rgba(34,211,238,.15);color:var(--cyan);font-size:10px">🏛️ ${tipos.prefeitura}</span> `;
    if(tipos.instituto_previdencia) badges += `<span class="pill" style="background:rgba(245,194,66,.15);color:var(--ylw);font-size:10px">📋 ${tipos.instituto_previdencia}</span> `;
    if(tipos.cartao_beneficio) badges += `<span class="pill" style="background:rgba(34,197,94,.15);color:var(--grn);font-size:10px">💳 ${tipos.cartao_beneficio}</span> `;
    h += `<div onclick="prefAbrirCidade('${esc(cid.municipio).replace(/'/g,"\\'")}')" style="background:var(--card);border:1px solid var(--brd);border-radius:10px;padding:14px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor='var(--acc)'" onmouseout="this.style.borderColor='var(--brd)'">`;
    h += `<div style="font-weight:800;font-size:15px;color:var(--t1)">📍 ${esc(cid.municipio)}</div>`;
    h += `<div style="font-size:12px;color:var(--t3);margin:6px 0">${cid.convenios.length} convênio(s)</div>`;
    h += `<div style="display:flex;gap:4px;flex-wrap:wrap">${badges}</div>`;
    h += `</div>`;
  }
  h += '</div></div>';
  return h;
}

// Camada 3: lista de Convenios dentro da Cidade
function renderPrefCidadeConvenios(){
  const uf = prefState.ufAberta;
  const cidade = prefState.cidadeAberta;
  const ufs = prefAgruparPorUfCidade();
  const grupo = ufs.find(g => g.uf === uf);
  const cid = grupo && grupo.cidades[cidade];
  let h = '<div style="max-width:1100px;margin:0 auto;padding:24px">';
  h += `<div style="margin-bottom:14px;display:flex;gap:8px;align-items:center;font-size:12px;color:var(--t3);flex-wrap:wrap">
    <a onclick="prefVoltarParaUfs()" style="cursor:pointer;color:var(--acc)">🏙️ Estados</a>
    <span>›</span>
    <a onclick="prefVoltarParaCidades()" style="cursor:pointer;color:var(--acc)">${esc(uf)}</a>
    <span>›</span>
    <span style="color:var(--t1);font-weight:700">📍 ${esc(cidade)}</span>
  </div>`;
  h += `<div style="font-size:22px;font-weight:800;margin-bottom:6px">📍 ${esc(cidade)}</div>`;
  h += `<div style="font-size:13px;color:var(--t2);margin-bottom:20px">${esc(uf)}${grupo&&grupo.estado_nome?' · '+esc(grupo.estado_nome):''} — escolha um convênio para ver as regras operacionais e bancos.</div>`;

  if(!cid || cid.convenios.length===0){
    h += '<div style="padding:40px;text-align:center;color:var(--t3)">Nenhum convênio encontrado.</div></div>'; return h;
  }
  // Agrupa por tipo (prefeitura primeiro, depois instituto, depois CB)
  const ord = {'prefeitura':0,'instituto_previdencia':1,'cartao_beneficio':2,'outro':3};
  const sorted = cid.convenios.slice().sort((a,b)=>(ord[a.tipo]??9)-(ord[b.tipo]??9) || a.nome.localeCompare(b.nome,'pt-BR'));
  h += '<div style="display:grid;gap:10px">';
  for(const c of sorted){
    h += `<div onclick="prefAbrirConvenio('${esc(c.slug)}')" style="background:var(--card);border:1px solid var(--brd);border-radius:10px;padding:14px;cursor:pointer;transition:border-color .15s;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap" onmouseover="this.style.borderColor='var(--acc)'" onmouseout="this.style.borderColor='var(--brd)'">`;
    h += `<div style="flex:1;min-width:240px"><div style="font-weight:700;font-size:14px;color:var(--t1)">${_prefTipoIcon(c.tipo)} ${esc(c.nome)}</div>`;
    h += `<div style="font-size:11px;color:var(--t3);margin-top:2px">${esc(_prefTipoLabel(c.tipo))} · ${esc(c.sheet_origem||'')}</div></div>`;
    h += `<button class="btn-acc btn-sm">Ver regras →</button>`;
    h += `</div>`;
  }
  h += '</div></div>';
  return h;
}

function renderPrefConvenioDetalhe(){
  const x = prefState.convenioAberto;
  let h = '<div style="max-width:1100px;margin:0 auto;padding:24px">';
  // Breadcrumb
  const c = x && x.convenio;
  if(c){
    h += `<div style="margin-bottom:14px;display:flex;gap:8px;align-items:center;font-size:12px;color:var(--t3);flex-wrap:wrap">
      <a onclick="prefVoltarParaUfs()" style="cursor:pointer;color:var(--acc)">🏙️ Estados</a>
      <span>›</span>
      <a onclick="prefVoltarParaCidades()" style="cursor:pointer;color:var(--acc)">${esc(c.uf||'')}</a>
      <span>›</span>
      <a onclick="prefFecharConvenio()" style="cursor:pointer;color:var(--acc)">📍 ${esc(c.municipio||'?')}</a>
      <span>›</span>
      <span style="color:var(--t1);font-weight:700">${esc(c.nome)}</span>
    </div>`;
  } else {
    h += `<div style="margin-bottom:16px"><button class="btn" onclick="prefFecharConvenio()">← Voltar</button></div>`;
  }
  if(x.loading){ h += '<div style="padding:40px;text-align:center;color:var(--t2)">⏳ Carregando…</div></div>'; return h; }
  if(x.error){ h += `<div style="padding:14px;background:rgba(239,68,68,.1);border:1px solid var(--red);border-radius:10px;color:var(--red)">❌ ${esc(x.error)}</div></div>`; return h; }

  const bancos = x.bancos || [];
  const tipoLab = _prefTipoLabel(c.tipo);
  const tipoIc = _prefTipoIcon(c.tipo);
  h += `<div style="font-size:24px;font-weight:800;margin-bottom:4px">${tipoIc} ${esc(c.nome)}</div>`;
  h += `<div style="font-size:12px;color:var(--t3);margin-bottom:6px">${c.uf?esc(c.uf):''} ${c.estado_nome?'— '+esc(c.estado_nome):''} ${c.municipio?'· 📍 '+esc(c.municipio):''} · ${esc(tipoLab)}</div>`;
  h += `<div style="font-size:11px;color:var(--t3);margin-bottom:18px">Aba: ${esc(c.sheet_origem||'')}${c.atualizado_em?' · 📅 '+esc(c.atualizado_em):''}</div>`;

  h += `<div style="margin-bottom:18px;padding:12px;background:rgba(34,211,238,.08);border:1px solid var(--cyan);border-radius:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">`;
  h += `<span style="font-size:13px;flex:1;min-width:200px">📄 Tem o holerite do servidor? Suba para ver quais bancos atendem.</span>`;
  h += `<button class="btn-acc btn-sm" onclick="prefState.convenioForcadoSlug='${esc(c.slug)}';setTab('prefHolerite')">📤 Analisar Holerite</button>`;
  h += `</div>`;

  if(bancos.length === 0){
    h += '<div style="padding:30px;text-align:center;color:var(--t3)">Sem bancos cadastrados para este convênio.</div></div>'; return h;
  }
  h += `<div style="font-size:13px;color:var(--t2);margin-bottom:10px">${bancos.length} banco(s) operam este convênio:</div>`;
  h += '<div style="display:grid;gap:10px">';
  for(const b of bancos){
    const ops = b.operacoes || {};
    const opsStr = ['novo','refin','port','cartao'].filter(k=>ops[k]).map(k=>{
      const lab = k==='cartao'?'Cartão':k.charAt(0).toUpperCase()+k.slice(1);
      return `<span class="pill pill-grn" style="font-size:10px">${lab}</span>`;
    }).join(' ');
    const susp = b.suspenso ? '<span class="pill" style="background:rgba(239,68,68,.15);color:var(--red);font-size:10px">⛔ Suspenso</span>' : '';
    const margem = b.margem_utilizavel ? `<div><span style="color:var(--t3);font-size:10px">Margem</span> <b>${(b.margem_utilizavel*100).toFixed(1)}%</b></div>` : '';
    const idade = (b.idade_min||b.idade_max) ? `<div><span style="color:var(--t3);font-size:10px">Idade</span> <b>${b.idade_min||'?'}-${b.idade_max||'?'}</b></div>` : '';
    const taxa = b.taxa_minima_port ? `<div><span style="color:var(--t3);font-size:10px">Taxa Port</span> <b>${(b.taxa_minima_port*100).toFixed(2)}%</b></div>` : '';
    const corte = b.data_corte ? `<div><span style="color:var(--t3);font-size:10px">Corte</span> <b>${esc(b.data_corte)}</b></div>` : '';
    const expandido = prefState.bancoExpandido === b.id;
    h += `<div style="background:var(--card);border:1px solid var(--brd);border-radius:10px;padding:14px;${b.suspenso?'opacity:.6':''}">`;
    h += `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:8px">`;
    h += `<div style="font-weight:800;font-size:15px">${esc(b.banco_nome)} ${susp}</div>`;
    h += `<div style="display:flex;gap:4px">${opsStr||'<span style="color:var(--t3);font-size:11px">— sem operações cadastradas</span>'}</div>`;
    h += `</div>`;
    h += `<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--t2)">${margem}${idade}${taxa}${corte}</div>`;
    h += `<div style="margin-top:10px"><button class="btn btn-sm" onclick="prefToggleBanco(${b.id})">${expandido?'▾ Esconder detalhes':'▸ Ver todos os campos do roteiro'}</button></div>`;
    if(expandido){
      const brutos = b.atributos_brutos || [];
      const porSecao = { principal:[], portabilidade:[], cartao:[], publico_alvo:[] };
      for(const a of brutos){ (porSecao[a.secao]||porSecao.principal).push(a); }
      h += '<div style="margin-top:12px;border-top:1px solid var(--brd);padding-top:12px">';
      const secoes = [['principal','📋 Operação'],['portabilidade','🔄 Portabilidade'],['cartao','💳 Cartão Benefício'],['publico_alvo','👥 Público-Alvo']];
      for(const [k,lab] of secoes){
        const items = porSecao[k] || [];
        if(items.length===0) continue;
        h += `<div style="margin-bottom:12px"><div style="font-size:11px;color:var(--t3);font-weight:800;text-transform:uppercase;margin-bottom:6px">${lab}</div>`;
        h += '<div style="display:grid;grid-template-columns:1fr;gap:6px;font-size:12px">';
        for(const a of items){
          h += `<div style="display:grid;grid-template-columns:240px 1fr;gap:12px;padding:6px 0;border-bottom:1px dashed var(--brd)"><div style="color:var(--t3)">${esc(a.label)}</div><div style="white-space:pre-line">${esc(a.valor)}</div></div>`;
        }
        h += '</div></div>';
      }
      h += '</div>';
    }
    h += '</div>';
  }
  h += '</div></div>';
  return h;
}

// ── Render: Análise de Holerite (Prefeituras)'''

# Substitui o bloco
m = PREF_BLOCK_RE.search(src)
if not m:
    print('ERRO: padrao do bloco PREF nao encontrado')
    sys.exit(1)
src2 = src[:m.start()] + PREF_NEW_BLOCK + src[m.end():]
print(f'PREF substituido: {m.end()-m.start()} bytes -> {len(PREF_NEW_BLOCK)} bytes')

# ──────────────────────────────────────────────────────────────────
# 2) Atualiza dropdown de convenio na tela de holerite (usa todosConvenios agora)
# ──────────────────────────────────────────────────────────────────
DROPDOWN_OLD = """  if(prefState.gruposCat){
    for(const g of prefState.gruposCat){
      h += `<optgroup label="${esc(g.uf||'')} - ${esc(g.estado_nome||'')}">`;
      for(const c of g.convenios){
        const muni = c.municipio?` (${esc(c.municipio)})`:'';
        h += `<option value="${esc(c.slug)}" ${prefState.convenioForcadoSlug===c.slug?'selected':''}>${esc(c.nome)}${muni}</option>`;
      }
      h += `</optgroup>`;
    }
  }"""
DROPDOWN_NEW = """  if(prefState.todosConvenios){
    // Reagrupa por UF pra exibir no dropdown
    const grupos = {};
    for(const c of prefState.todosConvenios){
      const uf = c.uf || 'OUTROS';
      if(!grupos[uf]) grupos[uf] = { uf, estado_nome: c.estado_nome, convenios: [] };
      grupos[uf].convenios.push(c);
    }
    const lista = Object.values(grupos).sort((a,b)=>(a.uf||'ZZ').localeCompare(b.uf||'ZZ'));
    for(const g of lista){
      h += `<optgroup label="${esc(g.uf||'')} - ${esc(g.estado_nome||'')}">`;
      for(const c of g.convenios){
        const muni = c.municipio?` (${esc(c.municipio)})`:'';
        h += `<option value="${esc(c.slug)}" ${prefState.convenioForcadoSlug===c.slug?'selected':''}>${esc(c.nome)}${muni}</option>`;
      }
      h += `</optgroup>`;
    }
  }"""
if DROPDOWN_OLD in src2:
    src2 = src2.replace(DROPDOWN_OLD, DROPDOWN_NEW, 1)
    print('Dropdown holerite atualizado')
else:
    print('AVISO: dropdown holerite nao encontrado para substituir')

# ──────────────────────────────────────────────────────────────────
# 3) Remove "(pode levar X-Ys)" das mensagens de loading
# ──────────────────────────────────────────────────────────────────
n_lev = 0
new_src, n = re.subn(r'\s*\(pode levar [\d\-]+s?\)', '', src2)
src2 = new_src
n_lev += n
new_src, n = re.subn(r'\s*\(pode levar \d+\-\d+ ?s\)', '', src2)
src2 = new_src
n_lev += n
# tambem remove "(~400 convênios, pode levar 30-60s)" no manutHtml
src2 = src2.replace(', pode levar 30-60s', '')
src2 = src2.replace('(~400 convênios, aguarde)', '(aguarde — pode demorar)')
print(f'Mensagens "pode levar" removidas: {n_lev} ocorrencias')

# ──────────────────────────────────────────────────────────────────
# 4) GOVERNOS — refator UI em 3 camadas (Estado -> Convenio -> Detalhe)
# ──────────────────────────────────────────────────────────────────

# Bloco gov: do let govState ate o cabecalho "// ── Render: Análise de Holerite ──"
GOV_BLOCK_RE = re.compile(
    r"let govState = \{[\s\S]*?// .. Render: An.lise de Holerite"
)

GOV_NEW_BLOCK = r'''let govState = {
  loadingCat: false, todosConvenios: null, errCat: null,
  carregouUmaVez: false,
  filtroBusca: '',
  ufAberta: null,             // ex: 'SP' (camada 2 ativa)
  convenioAberto: null,       // {convenio, bancos} (camada 3 ativa)
  bancoExpandido: null,
  arquivoBase64: null, arquivoNome: null, arquivoTipo: null, arquivoTamanho: 0,
  loadingHol: false, errHol: null, resultadoHol: null,
  convenioForcadoSlug: '',
};

async function govCarregarConvenios(){
  govState.loadingCat = true; govState.errCat = null; renderApp();
  try{
    // Carrega todos de uma vez; filtro/agrupamento eh client-side
    const r = await apiFetch('/api/gov',{method:'POST',body:JSON.stringify({action:'listConvenios'})});
    if(r.status === 404){ throw new Error('Endpoint /api/gov nao existe no servidor — falta fazer git push do api/gov.js'); }
    const d = await r.json();
    if(!d.ok) throw new Error(d.error||'Falha');
    govState.todosConvenios = d.convenios || [];
  }catch(e){ govState.errCat = e.message; }
  govState.loadingCat = false;
  govState.carregouUmaVez = true;
  renderApp();
}

function govAbrirUf(uf){ govState.ufAberta = uf; govState.convenioAberto = null; renderApp(); }
function govVoltarParaUfs(){ govState.ufAberta = null; govState.convenioAberto = null; renderApp(); }

async function govAbrirConvenio(slug){
  govState.convenioAberto = { loading: true };
  renderApp();
  try{
    const r = await apiFetch('/api/gov',{method:'POST',body:JSON.stringify({action:'getConvenio', slug})});
    const d = await r.json();
    if(!d.ok) throw new Error(d.error||'Falha');
    govState.convenioAberto = { convenio: d.convenio, bancos: d.bancos };
  }catch(e){ govState.convenioAberto = { error: e.message }; }
  govState.bancoExpandido = null;
  renderApp();
}

function govFecharConvenio(){ govState.convenioAberto = null; govState.bancoExpandido = null; renderApp(); }

function govToggleBanco(id){
  govState.bancoExpandido = govState.bancoExpandido === id ? null : id;
  renderApp();
}

function govAgruparPorUf(){
  const lista = govState.todosConvenios || [];
  const norm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const q = norm(govState.filtroBusca || '').trim();
  const filtrados = lista.filter(c => {
    if(!q) return true;
    return norm(c.nome).includes(q) || norm(c.sheet_origem||'').includes(q) || norm(c.uf||'').includes(q);
  });
  const ufs = {};
  for(const c of filtrados){
    const uf = c.uf || 'OUTROS';
    if(!ufs[uf]) ufs[uf] = { uf, estado_nome: c.estado_nome, convenios: [] };
    ufs[uf].convenios.push(c);
  }
  return Object.values(ufs).sort((a,b)=>(a.uf||'ZZ').localeCompare(b.uf||'ZZ'));
}

function _govHeaderBusca(){
  return `<div style="margin-bottom:18px"><input class="form-input" placeholder="🔍 Buscar (TJ, governo, ministério, ex: TJMG, GOV PA, Bahia)..." value="${esc(govState.filtroBusca)}" oninput="govState.filtroBusca=this.value;renderApp()" style="width:100%"></div>`;
}

// Render: Catalogo (3 camadas: Estado -> Convenio -> Detalhe)
function renderGovCatalogo(){
  if(!govState.carregouUmaVez && !govState.loadingCat){ govCarregarConvenios(); }
  if(govState.convenioAberto) return renderGovConvenioDetalhe();
  if(govState.ufAberta) return renderGovUfConvenios();
  return renderGovEstados();
}

// Camada 1: lista de Estados
function renderGovEstados(){
  let h = '<div style="max-width:1100px;margin:0 auto;padding:24px">';
  h += '<div style="font-size:22px;font-weight:800;margin-bottom:6px">🏛️ Catálogo de Governos</div>';
  h += '<div style="font-size:13px;color:var(--t2);margin-bottom:20px">Convênios estaduais (governos, tribunais, autarquias). Escolha um estado para ver os convênios disponíveis.</div>';
  h += _govHeaderBusca();

  if(govState.loadingCat){ h += '<div style="padding:40px;text-align:center;color:var(--t2)">⏳ Carregando…</div></div>'; return h; }
  if(govState.errCat){
    h += `<div style="padding:14px;background:rgba(239,68,68,.1);border:1px solid var(--red);border-radius:10px;color:var(--red);margin-bottom:12px">❌ ${esc(govState.errCat)}</div>`;
    h += `<div style="text-align:center"><button class="btn-acc" onclick="govState.carregouUmaVez=false;govCarregarConvenios()">🔄 Tentar de novo</button></div></div>`;
    return h;
  }
  const ufs = govAgruparPorUf();
  if(ufs.length === 0){
    h += '<div style="padding:40px;text-align:center;color:var(--t3)">Nenhum convênio encontrado.</div></div>'; return h;
  }
  const totalConv = ufs.reduce((s,u)=>s+u.convenios.length,0);
  h += `<div style="font-size:12px;color:var(--t3);margin-bottom:14px">${ufs.length} estado(s)/região(ões) · ${totalConv} convênio(s)</div>`;
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">';
  for(const u of ufs){
    h += `<div onclick="govAbrirUf('${esc(u.uf)}')" style="background:var(--card);border:1px solid var(--brd);border-radius:12px;padding:18px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--acc)';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--brd)';this.style.transform='translateY(0)'">`;
    h += `<div style="font-size:28px;font-weight:900;color:var(--acc);line-height:1">${esc(u.uf)}</div>`;
    h += `<div style="font-size:13px;color:var(--t2);margin-top:4px">${esc(u.estado_nome||'')}</div>`;
    h += `<div style="font-size:12px;color:var(--t3);margin-top:8px">📋 ${u.convenios.length} convênio(s)</div>`;
    h += `</div>`;
  }
  h += '</div></div>';
  return h;
}

// Camada 2: lista de Convenios dentro do Estado
function renderGovUfConvenios(){
  const uf = govState.ufAberta;
  const ufs = govAgruparPorUf();
  const grupo = ufs.find(g => g.uf === uf);
  let h = '<div style="max-width:1100px;margin:0 auto;padding:24px">';
  h += `<div style="margin-bottom:14px;display:flex;gap:8px;align-items:center;font-size:12px;color:var(--t3);flex-wrap:wrap">
    <a onclick="govVoltarParaUfs()" style="cursor:pointer;color:var(--acc)">🏛️ Estados</a>
    <span>›</span>
    <span style="color:var(--t1);font-weight:700">${esc(uf)}${grupo&&grupo.estado_nome?' · '+esc(grupo.estado_nome):''}</span>
  </div>`;
  h += `<div style="font-size:22px;font-weight:800;margin-bottom:6px">${esc(grupo?grupo.estado_nome:uf)} <span style="color:var(--t3);font-weight:400;font-size:14px">(${esc(uf)})</span></div>`;
  h += '<div style="font-size:13px;color:var(--t2);margin-bottom:20px">Escolha um convênio para ver as regras operacionais e bancos.</div>';

  if(!grupo || grupo.convenios.length===0){
    h += '<div style="padding:40px;text-align:center;color:var(--t3)">Nenhum convênio encontrado.</div></div>'; return h;
  }
  const sorted = grupo.convenios.slice().sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  h += `<div style="font-size:12px;color:var(--t3);margin-bottom:14px">${sorted.length} convênio(s)</div>`;
  h += '<div style="display:grid;gap:10px">';
  for(const c of sorted){
    h += `<div onclick="govAbrirConvenio('${esc(c.slug)}')" style="background:var(--card);border:1px solid var(--brd);border-radius:10px;padding:14px;cursor:pointer;transition:border-color .15s;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap" onmouseover="this.style.borderColor='var(--acc)'" onmouseout="this.style.borderColor='var(--brd)'">`;
    h += `<div style="flex:1;min-width:240px"><div style="font-weight:700;font-size:14px;color:var(--t1)">${esc(c.nome)}</div>`;
    h += `<div style="font-size:11px;color:var(--t3);margin-top:2px">${esc(c.sheet_origem||'')}</div></div>`;
    h += `<button class="btn-acc btn-sm">Ver regras →</button>`;
    h += `</div>`;
  }
  h += '</div></div>';
  return h;
}

function renderGovConvenioDetalhe(){
  const x = govState.convenioAberto;
  let h = '<div style="max-width:1100px;margin:0 auto;padding:24px">';
  const c = x && x.convenio;
  if(c){
    h += `<div style="margin-bottom:14px;display:flex;gap:8px;align-items:center;font-size:12px;color:var(--t3);flex-wrap:wrap">
      <a onclick="govVoltarParaUfs()" style="cursor:pointer;color:var(--acc)">🏛️ Estados</a>
      <span>›</span>
      <a onclick="govFecharConvenio()" style="cursor:pointer;color:var(--acc)">${esc(c.uf||'')}</a>
      <span>›</span>
      <span style="color:var(--t1);font-weight:700">${esc(c.nome)}</span>
    </div>`;
  } else {
    h += `<div style="margin-bottom:16px"><button class="btn" onclick="govFecharConvenio()">← Voltar</button></div>`;
  }
  if(x.loading){ h += '<div style="padding:40px;text-align:center;color:var(--t2)">⏳ Carregando…</div></div>'; return h; }
  if(x.error){ h += `<div style="padding:14px;background:rgba(239,68,68,.1);border:1px solid var(--red);border-radius:10px;color:var(--red)">❌ ${esc(x.error)}</div></div>`; return h; }

  const bancos = x.bancos || [];
  h += `<div style="font-size:24px;font-weight:800;margin-bottom:4px">${esc(c.nome)}</div>`;
  h += `<div style="font-size:12px;color:var(--t3);margin-bottom:6px">${c.uf?esc(c.uf):''} ${c.estado_nome?'— '+esc(c.estado_nome):''} · Aba: ${esc(c.sheet_origem||'')}</div>`;
  if(c.atualizado_em) h += `<div style="font-size:11px;color:var(--t3);margin-bottom:18px">📅 Atualizado em ${esc(c.atualizado_em)}</div>`;

  h += `<div style="margin-bottom:18px;padding:12px;background:rgba(34,211,238,.08);border:1px solid var(--cyan);border-radius:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">`;
  h += `<span style="font-size:13px;flex:1;min-width:200px">📄 Tem o holerite do cliente? Suba para ver quais bancos atendem.</span>`;
  h += `<button class="btn-acc btn-sm" onclick="govState.convenioForcadoSlug='${esc(c.slug)}';setTab('govHolerite')">📤 Analisar Holerite</button>`;
  h += `</div>`;

  if(bancos.length === 0){
    h += '<div style="padding:30px;text-align:center;color:var(--t3)">Sem bancos cadastrados para este convênio.</div></div>'; return h;
  }
  h += `<div style="font-size:13px;color:var(--t2);margin-bottom:10px">${bancos.length} banco(s) operam este convênio:</div>`;
  h += '<div style="display:grid;gap:10px">';
  for(const b of bancos){
    const ops = b.operacoes || {};
    const opsStr = ['novo','refin','port','cartao'].filter(k=>ops[k]).map(k=>{
      const lab = k==='cartao'?'Cartão':k.charAt(0).toUpperCase()+k.slice(1);
      return `<span class="pill pill-grn" style="font-size:10px">${lab}</span>`;
    }).join(' ');
    const susp = b.suspenso ? '<span class="pill" style="background:rgba(239,68,68,.15);color:var(--red);font-size:10px">⛔ Suspenso</span>' : '';
    const margem = b.margem_utilizavel ? `<div><span style="color:var(--t3);font-size:10px">Margem</span> <b>${(b.margem_utilizavel*100).toFixed(1)}%</b></div>` : '';
    const idade = (b.idade_min||b.idade_max) ? `<div><span style="color:var(--t3);font-size:10px">Idade</span> <b>${b.idade_min||'?'}-${b.idade_max||'?'}</b></div>` : '';
    const taxa = b.taxa_minima_port ? `<div><span style="color:var(--t3);font-size:10px">Taxa Port</span> <b>${(b.taxa_minima_port*100).toFixed(2)}%</b></div>` : '';
    const corte = b.data_corte ? `<div><span style="color:var(--t3);font-size:10px">Corte</span> <b>${esc(b.data_corte)}</b></div>` : '';
    const expandido = govState.bancoExpandido === b.id;
    h += `<div style="background:var(--card);border:1px solid var(--brd);border-radius:10px;padding:14px;${b.suspenso?'opacity:.6':''}">`;
    h += `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:8px">`;
    h += `<div style="font-weight:800;font-size:15px">${esc(b.banco_nome)} ${susp}</div>`;
    h += `<div style="display:flex;gap:4px">${opsStr||'<span style="color:var(--t3);font-size:11px">— sem operações cadastradas</span>'}</div>`;
    h += `</div>`;
    h += `<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--t2)">${margem}${idade}${taxa}${corte}</div>`;
    h += `<div style="margin-top:10px"><button class="btn btn-sm" onclick="govToggleBanco(${b.id})">${expandido?'▾ Esconder detalhes':'▸ Ver todos os campos do roteiro'}</button></div>`;
    if(expandido){
      const brutos = b.atributos_brutos || [];
      const porSecao = { principal:[], portabilidade:[], cartao:[], publico_alvo:[] };
      for(const a of brutos){ (porSecao[a.secao]||porSecao.principal).push(a); }
      h += '<div style="margin-top:12px;border-top:1px solid var(--brd);padding-top:12px">';
      const secoes = [['principal','📋 Operação'],['portabilidade','🔄 Portabilidade'],['cartao','💳 Cartão Benefício'],['publico_alvo','👥 Público-Alvo']];
      for(const [k,lab] of secoes){
        const items = porSecao[k] || [];
        if(items.length===0) continue;
        h += `<div style="margin-bottom:12px"><div style="font-size:11px;color:var(--t3);font-weight:800;text-transform:uppercase;margin-bottom:6px">${lab}</div>`;
        h += '<div style="display:grid;grid-template-columns:1fr;gap:6px;font-size:12px">';
        for(const a of items){
          h += `<div style="display:grid;grid-template-columns:240px 1fr;gap:12px;padding:6px 0;border-bottom:1px dashed var(--brd)"><div style="color:var(--t3)">${esc(a.label)}</div><div style="white-space:pre-line">${esc(a.valor)}</div></div>`;
        }
        h += '</div></div>';
      }
      h += '</div>';
    }
    h += '</div>';
  }
  h += '</div></div>';
  return h;
}

// ── Render: Análise de Holerite'''

m2 = GOV_BLOCK_RE.search(src2)
if not m2:
    print('AVISO: padrao do bloco GOV nao encontrado — gov nao sera refatorado')
else:
    src2 = src2[:m2.start()] + GOV_NEW_BLOCK + src2[m2.end():]
    print(f'GOV substituido: {m2.end()-m2.start()} bytes -> {len(GOV_NEW_BLOCK)} bytes')

# ──────────────────────────────────────────────────────────────────
# 5) Atualiza dropdown holerite Gov (que usa govState.gruposCat) pra usar todosConvenios
# ──────────────────────────────────────────────────────────────────
GOV_DROPDOWN_OLD = """  if(govState.gruposCat){
    for(const g of govState.gruposCat){
      h += `<optgroup label="${esc(g.uf||'')} - ${esc(g.estado_nome||'')}">`;
      for(const c of g.convenios){
        h += `<option value="${esc(c.slug)}" ${govState.convenioForcadoSlug===c.slug?'selected':''}>${esc(c.nome)}</option>`;
      }
      h += `</optgroup>`;
    }
  }"""
GOV_DROPDOWN_NEW = """  if(govState.todosConvenios){
    const grupos = {};
    for(const c of govState.todosConvenios){
      const uf = c.uf || 'OUTROS';
      if(!grupos[uf]) grupos[uf] = { uf, estado_nome: c.estado_nome, convenios: [] };
      grupos[uf].convenios.push(c);
    }
    const lista = Object.values(grupos).sort((a,b)=>(a.uf||'ZZ').localeCompare(b.uf||'ZZ'));
    for(const g of lista){
      h += `<optgroup label="${esc(g.uf||'')} - ${esc(g.estado_nome||'')}">`;
      for(const c of g.convenios){
        h += `<option value="${esc(c.slug)}" ${govState.convenioForcadoSlug===c.slug?'selected':''}>${esc(c.nome)}</option>`;
      }
      h += `</optgroup>`;
    }
  }"""
if GOV_DROPDOWN_OLD in src2:
    src2 = src2.replace(GOV_DROPDOWN_OLD, GOV_DROPDOWN_NEW, 1)
    print('Dropdown holerite GOV atualizado')

# Salva
HTML.write_text(src2, encoding='utf-8')
print(f'\nSALVO: {HTML}')
print(f'  Antes:  {orig_size:>9,} bytes')
print(f'  Depois: {len(src2):>9,} bytes')
print(f'  Delta:  {len(src2)-orig_size:+,} bytes')
