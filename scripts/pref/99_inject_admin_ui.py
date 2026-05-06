"""
Injeta UI de admin (cadastrar/editar/remover banco em convenio) no index.html.
Funciona pra ambos PREFEITURAS (prefState/api/pref) e GOVERNOS (govState/api/gov).
Re-rodavel (idempotente).
"""
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent.parent.parent
HTML = ROOT / 'index.html'
src = HTML.read_text(encoding='utf-8')
orig = len(src)

# ── Bloco compartilhado: estado global do modal + funcoes de abrir/fechar/salvar ──
ADMIN_BLOCK = r'''// ══════════════════════════════════════════════════════════════
// ADMIN: cadastro manual de bancos em convenios (Pref + Gov)
// ══════════════════════════════════════════════════════════════
let adminBancoModal = {
  aberto: false,
  modulo: null,         // 'pref' ou 'gov'
  convenio: null,       // {id, nome, slug}
  vinculo: null,        // null = novo; objeto = editar
  bancos: [],           // lista de bancos disponiveis pra dropdown
  loadingBancos: false,
  saving: false, err: null,
  // form state
  form: {},
};

function _admEhAdmin(){
  return CU && (CU.role === 'admin' || CU.role === 'gestor');
}

function admBancoFormDefault(vinculo){
  const v = vinculo || {};
  const ops = v.operacoes || {};
  return {
    id: v.id || null,
    banco_id: v.banco_id || '',
    novo_banco_nome: '',
    suspenso: !!v.suspenso,
    opera_novo: !!ops.novo, opera_refin: !!ops.refin, opera_port: !!ops.port, opera_cartao: !!ops.cartao,
    regime_atendido: v.regime_atendido || 'RPPS',
    publico_ativo: v.publico_ativo !== false,
    publico_aposentado: v.publico_aposentado !== false,
    publico_pensionista: v.publico_pensionista !== false,
    margem_utilizavel: v.margem_utilizavel !== null && v.margem_utilizavel !== undefined ? (v.margem_utilizavel * 100).toFixed(2).replace('.',',') : '',
    taxa_minima_port: v.taxa_minima_port !== null && v.taxa_minima_port !== undefined ? (v.taxa_minima_port * 100).toFixed(2).replace('.',',') : '',
    idade_min: v.idade_min ?? '',
    idade_max: v.idade_max ?? '',
    prazo_max_meses: v.prazo_max_meses ?? '',
    valor_minimo_op: v.valor_minimo_op ?? '',
    valor_maximo_op: v.valor_maximo_op ?? '',
    data_corte: v.data_corte || '',
    qtd_contratos: v.qtd_contratos || '',
    observacoes_admin: v.observacoes_admin || '',
  };
}

async function admAbrirModalBanco(modulo, convenio, vinculo){
  adminBancoModal.aberto = true;
  adminBancoModal.modulo = modulo;
  adminBancoModal.convenio = convenio;
  adminBancoModal.vinculo = vinculo;
  adminBancoModal.err = null;
  adminBancoModal.saving = false;
  adminBancoModal.form = admBancoFormDefault(vinculo);
  // Carrega lista de bancos disponiveis
  adminBancoModal.loadingBancos = true; renderApp();
  try{
    const r = await apiFetch('/api/'+modulo, {method:'POST', body: JSON.stringify({action:'listBancos'})});
    const d = await r.json();
    adminBancoModal.bancos = d.ok ? (d.bancos || []) : [];
  }catch(e){ adminBancoModal.bancos = []; }
  adminBancoModal.loadingBancos = false;
  renderApp();
}

function admFecharModal(){ adminBancoModal.aberto = false; renderApp(); }

async function admSalvarBanco(){
  const m = adminBancoModal;
  m.err = null; m.saving = true; renderApp();
  try{
    let bancoId = m.form.banco_id ? parseInt(m.form.banco_id, 10) : null;
    // Se escolheu "+ Criar novo banco" (banco_id vazio mas tem nome novo)
    if (!bancoId && m.form.novo_banco_nome && m.form.novo_banco_nome.trim()){
      const rNew = await apiFetch('/api/'+m.modulo, {method:'POST', body: JSON.stringify({
        action: m.modulo === 'gov' ? 'upsertBanco' : 'criarBanco',
        nome: m.form.novo_banco_nome.trim()
      })});
      const dNew = await rNew.json();
      if(!dNew.ok) throw new Error(dNew.error || 'Falha ao criar banco');
      bancoId = (dNew.banco && dNew.banco.id) || (dNew.registro && dNew.registro.id);
    }
    if(!bancoId) throw new Error('Selecione um banco existente OU informe nome de novo banco');

    const payload = {
      action: 'upsertBancoConvenio',
      id: m.form.id || undefined,
      banco_id: bancoId,
      convenio_id: m.convenio.id,
      suspenso: m.form.suspenso,
      opera_novo: m.form.opera_novo, opera_refin: m.form.opera_refin,
      opera_port: m.form.opera_port, opera_cartao: m.form.opera_cartao,
      regime_atendido: m.form.regime_atendido,
      publico_ativo: m.form.publico_ativo,
      publico_aposentado: m.form.publico_aposentado,
      publico_pensionista: m.form.publico_pensionista,
      margem_utilizavel: m.form.margem_utilizavel,
      taxa_minima_port: m.form.taxa_minima_port,
      idade_min: m.form.idade_min, idade_max: m.form.idade_max,
      prazo_max_meses: m.form.prazo_max_meses,
      valor_minimo_op: m.form.valor_minimo_op,
      valor_maximo_op: m.form.valor_maximo_op,
      data_corte: m.form.data_corte,
      qtd_contratos: m.form.qtd_contratos,
      observacoes_admin: m.form.observacoes_admin,
    };
    const r = await apiFetch('/api/'+m.modulo, {method:'POST', body: JSON.stringify(payload)});
    const d = await r.json();
    if(!d.ok) throw new Error(d.error || 'Falha ao salvar');
    // Sucesso: fecha modal e recarrega o convenio aberto
    adminBancoModal.aberto = false;
    if(m.modulo === 'pref' && prefState.convenioAberto && prefState.convenioAberto.convenio){
      await prefAbrirConvenio(prefState.convenioAberto.convenio.slug);
    } else if(m.modulo === 'gov' && govState.convenioAberto && govState.convenioAberto.convenio){
      await govAbrirConvenio(govState.convenioAberto.convenio.slug);
    } else {
      renderApp();
    }
  }catch(e){ m.err = e.message; m.saving = false; renderApp(); }
}

async function admRemoverBanco(modulo, vinculoId, bancoNome){
  if(!confirm(`Remover o banco "${bancoNome}" deste convênio?`)) return;
  try{
    const r = await apiFetch('/api/'+modulo, {method:'POST', body: JSON.stringify({action:'deleteBancoConvenio', id: vinculoId})});
    const d = await r.json();
    if(!d.ok) throw new Error(d.error || 'Falha');
    // Recarrega
    if(modulo === 'pref' && prefState.convenioAberto && prefState.convenioAberto.convenio){
      await prefAbrirConvenio(prefState.convenioAberto.convenio.slug);
    } else if(modulo === 'gov' && govState.convenioAberto && govState.convenioAberto.convenio){
      await govAbrirConvenio(govState.convenioAberto.convenio.slug);
    }
  }catch(e){ alert('Erro ao remover: '+e.message); }
}

function _admInputChk(field, label){
  const m = adminBancoModal;
  const checked = m.form[field] ? 'checked' : '';
  return `<label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-size:13px"><input type="checkbox" ${checked} onchange="adminBancoModal.form['${field}']=this.checked;renderApp()"> ${label}</label>`;
}

function _admInputText(field, label, placeholder, type){
  const m = adminBancoModal;
  type = type || 'text';
  return `<div style="display:flex;flex-direction:column;gap:4px"><label style="font-size:11px;color:var(--t3)">${label}</label><input type="${type}" class="form-input" value="${esc(String(m.form[field]||''))}" placeholder="${placeholder||''}" oninput="adminBancoModal.form['${field}']=this.value" style="font-size:13px;padding:8px 10px"></div>`;
}

function renderAdminBancoModal(){
  const m = adminBancoModal;
  if(!m.aberto) return '';
  const titulo = m.vinculo ? '✏️ Editar banco no convênio' : '+ Adicionar banco ao convênio';
  let h = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto" onclick="if(event.target===this)admFecharModal()">`;
  h += `<div style="background:var(--card);border:1px solid var(--brd);border-radius:14px;max-width:780px;width:100%;max-height:90vh;overflow-y:auto;padding:24px">`;
  h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">`;
  h += `<div><div style="font-size:18px;font-weight:800">${titulo}</div><div style="font-size:12px;color:var(--t3);margin-top:2px">Convênio: ${esc(m.convenio.nome)}</div></div>`;
  h += `<button class="btn btn-sm" onclick="admFecharModal()">✕</button></div>`;

  if(m.err){ h += `<div style="padding:10px;background:rgba(239,68,68,.1);border:1px solid var(--red);border-radius:8px;color:var(--red);margin-bottom:14px;font-size:12px">❌ ${esc(m.err)}</div>`; }

  // ── Banco (selecionar OU criar) ──
  h += `<div style="margin-bottom:14px"><label style="font-size:11px;color:var(--t3);font-weight:700;text-transform:uppercase">Banco</label>`;
  if(m.vinculo){
    // Editar: banco fixo
    const bancoNome = m.vinculo.banco_nome || '?';
    h += `<div style="padding:10px;background:var(--bg);border:1px solid var(--brd);border-radius:8px;margin-top:4px;font-weight:600">${esc(bancoNome)}</div>`;
  } else {
    h += `<select class="form-input" onchange="adminBancoModal.form.banco_id=this.value;renderApp()" style="margin-top:4px;font-size:13px"><option value="">— Selecione ou crie novo abaixo —</option>`;
    for(const b of (m.bancos||[])){
      h += `<option value="${b.id}" ${String(m.form.banco_id)===String(b.id)?'selected':''}>${esc(b.nome)}</option>`;
    }
    h += `</select>`;
    h += `<input type="text" class="form-input" placeholder="OU digite o nome de um banco novo" value="${esc(m.form.novo_banco_nome||'')}" oninput="adminBancoModal.form.novo_banco_nome=this.value" style="margin-top:6px;font-size:13px;padding:8px 10px">`;
  }
  h += `</div>`;

  // ── Operações ──
  h += `<div style="margin-bottom:14px"><div style="font-size:11px;color:var(--t3);font-weight:700;text-transform:uppercase;margin-bottom:6px">📋 Operações</div>`;
  h += `<div style="display:flex;gap:18px;flex-wrap:wrap">`
     + _admInputChk('opera_novo','Novo')
     + _admInputChk('opera_refin','Refin')
     + _admInputChk('opera_port','Portabilidade')
     + _admInputChk('opera_cartao','Cartão Benefício')
     + `</div></div>`;

  // ── Regime Previdenciário ──
  h += `<div style="margin-bottom:14px"><div style="font-size:11px;color:var(--t3);font-weight:700;text-transform:uppercase;margin-bottom:6px">🏛️ Regime Previdenciário Atendido</div>`;
  h += `<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px">`;
  for(const [val, lab] of [['RPPS','RPPS — Estatutário (instituto próprio)'],['RGPS','RGPS — CLT/comissionado (INSS)'],['AMBOS','AMBOS']]){
    const checked = m.form.regime_atendido === val ? 'checked' : '';
    h += `<label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="radio" name="adm_regime" value="${val}" ${checked} onchange="adminBancoModal.form.regime_atendido='${val}';renderApp()"> ${lab}</label>`;
  }
  h += `</div></div>`;

  // ── Público alvo ──
  h += `<div style="margin-bottom:14px"><div style="font-size:11px;color:var(--t3);font-weight:700;text-transform:uppercase;margin-bottom:6px">👥 Público-Alvo</div>`;
  h += `<div style="display:flex;gap:18px;flex-wrap:wrap">`
     + _admInputChk('publico_ativo','Ativo')
     + _admInputChk('publico_aposentado','Aposentado')
     + _admInputChk('publico_pensionista','Pensionista')
     + `</div></div>`;

  // ── Suspenso ──
  h += `<div style="margin-bottom:14px;padding:10px;background:rgba(239,68,68,.06);border-radius:8px">${_admInputChk('suspenso','⛔ Banco suspenso neste convênio')}</div>`;

  // ── Regras numéricas (grid 2 colunas) ──
  h += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:14px">`
     + _admInputText('margem_utilizavel','Margem (%)','35 ou 0.35')
     + _admInputText('taxa_minima_port','Taxa mínima Port (%/mês)','1.85')
     + _admInputText('idade_min','Idade mínima','21','number')
     + _admInputText('idade_max','Idade máxima','79','number')
     + _admInputText('prazo_max_meses','Prazo máx (meses)','96','number')
     + _admInputText('valor_minimo_op','Valor mínimo (R$)','500','number')
     + _admInputText('valor_maximo_op','Valor máximo (R$)','50000','number')
     + _admInputText('data_corte','Data de corte','Dia 15')
     + `</div>`;

  // ── Observações ──
  h += `<div style="margin-bottom:14px"><label style="font-size:11px;color:var(--t3)">Observações (regras especiais, exigências, etc.)</label>`;
  h += `<textarea class="form-input" rows="3" oninput="adminBancoModal.form.observacoes_admin=this.value" placeholder="Ex: Exige tempo mínimo de 6 meses no cargo. Não aceita servidor com histórico de inadimplência." style="font-size:13px;width:100%;resize:vertical;padding:8px 10px;margin-top:4px">${esc(m.form.observacoes_admin||'')}</textarea>`;
  h += `</div>`;

  // ── Botões ──
  h += `<div style="display:flex;gap:10px;justify-content:flex-end;border-top:1px solid var(--brd);padding-top:14px">`;
  h += `<button class="btn" onclick="admFecharModal()" ${m.saving?'disabled':''}>Cancelar</button>`;
  h += `<button class="btn-acc" onclick="admSalvarBanco()" ${m.saving?'disabled':''}>${m.saving?'⏳ Salvando…':'💾 Salvar'}</button>`;
  h += `</div>`;

  h += `</div></div>`;
  return h;
}

'''

# Inserir o ADMIN_BLOCK uma vez no arquivo (antes de "function renderConsulta()" que é um marcador estável)
MARK = 'function renderConsulta() {'
if 'let adminBancoModal' not in src:
    if MARK not in src:
        print('ERRO: marcador de inserção (renderConsulta) não encontrado')
        sys.exit(1)
    src = src.replace(MARK, ADMIN_BLOCK + MARK, 1)
    print('ADMIN_BLOCK injetado')
else:
    print('ADMIN_BLOCK já presente — re-injeção pulada')

# ── Injeta o modal no body do app: vamos colocar logo depois do </body> não, na tabContent
# Melhor: dentro de renderPrefCatalogo + renderGovCatalogo o modal já estará incluído via renderApp,
# mas como o modal é global, melhor incluir uma vez fixa no DOM. Vou pô-lo no return de renderApp/main.
# Estratégia: incluir no final dos retornos das funções de detalhe.

# Atualiza renderPrefConvenioDetalhe pra:
#  1. Mostrar botão "+ Adicionar banco" no topo (se admin)
#  2. Em cada banco, mostrar botões ✏️ / 🗑 (se admin)
#  3. Adicionar badge de regime + público
#  4. Anexar renderAdminBancoModal() no final

# Substitui o bloco de cada banco em renderPrefConvenioDetalhe
PREF_BANCO_LOOP_OLD = '''  for(const b of bancos){
    const ops = b.operacoes || {};
    const opsStr = ['novo','refin','port','cartao'].filter(k=>ops[k]).map(k=>{
      const lab = k==='cartao'?'Cartão':k.charAt(0).toUpperCase()+k.slice(1);
      return `<span class="pill pill-grn" style="font-size:10px">${lab}</span>`;
    }).join(' ');
    const susp = b.suspenso ? '<span class="pill" style="background:rgba(239,68,68,.15);color:var(--red);font-size:10px">⛔ Suspenso</span>' : ''';
PREF_BANCO_LOOP_NEW = '''  for(const b of bancos){
    const ops = b.operacoes || {};
    const opsStr = ['novo','refin','port','cartao'].filter(k=>ops[k]).map(k=>{
      const lab = k==='cartao'?'Cartão':k.charAt(0).toUpperCase()+k.slice(1);
      return `<span class="pill pill-grn" style="font-size:10px">${lab}</span>`;
    }).join(' ');
    const susp = b.suspenso ? '<span class="pill" style="background:rgba(239,68,68,.15);color:var(--red);font-size:10px">⛔ Suspenso</span>' : ''';

# Hmm — inserir botões edit/remove e badges sem quebrar a estrutura existente é arriscado via re.replace.
# Estratégia mais segura: encontro a linha de abertura "for(const b of bancos){" em renderPrefConvenioDetalhe
# e enxerto novas funcionalidades via wrapping.

# Em vez disso, faço uma substituição mais cirúrgica: após `${susp}`, adicionar badge regime/publico + botoes admin
# Mas a expressao `${susp}` aparece duas vezes (pref e gov). Vou usar contexto pra distinguir.

def add_after_susp(src, state_var, modulo):
    """No render*ConvenioDetalhe, injeta apos `${esc(b.banco_nome)} ${susp}` os badges de regime + botoes admin."""
    needle = '`<div style="font-weight:800;font-size:15px">${esc(b.banco_nome)} ${susp}</div>`'
    # Monta usando aspas duplas
    rep_lines = [
        '`<div style="font-weight:800;font-size:15px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">',
        '${esc(b.banco_nome)} ${susp}',
        '${b.regime_atendido && b.regime_atendido!=="RPPS" ? `<span class="pill" style="background:rgba(34,211,238,.15);color:var(--cyan);font-size:9px">${b.regime_atendido}</span>` : ""}',
        '${b.criado_por_admin ? `<span class="pill" style="background:rgba(245,194,66,.12);color:var(--ylw);font-size:9px" title="Cadastrado manualmente">✋ ADM</span>` : ""}',
        f'${{_admEhAdmin() ? `<button class="btn btn-sm" style="font-size:10px;padding:2px 6px;margin-left:6px" title="Editar" onclick="admAbrirModalBanco(\'{modulo}\', {state_var}.convenioAberto.convenio, {state_var}.convenioAberto.bancos.find(x=>x.id===${{b.id}}))">✏️</button><button class="btn btn-sm" style="font-size:10px;padding:2px 6px" title="Remover" onclick="admRemoverBanco(\'{modulo}\', ${{b.id}}, ${{JSON.stringify(b.banco_nome||\"\")}})">🗑</button>` : ""}}',
        '</div>`',
    ]
    rep = ''.join(rep_lines)
    idx_state = src.find(state_var + '.bancoExpandido')
    if idx_state == -1:
        print(f'AVISO: state {state_var} não encontrado pra contexto')
        return src
    idx_needle = src.find(needle, max(0, idx_state - 5000))
    if idx_needle == -1 or idx_needle > idx_state + 5000:
        idx_needle = src.find(needle)
    if idx_needle != -1:
        src = src[:idx_needle] + rep + src[idx_needle + len(needle):]
        print(f'Banco header injetado para {modulo}')
    else:
        print(f'AVISO: needle não encontrado para {modulo}')
    return src

src = add_after_susp(src, 'prefState', 'pref')
src = add_after_susp(src, 'govState', 'gov')

# Adiciona botão "+ Adicionar banco" na linha "${bancos.length} banco(s) operam este convênio:"
ADD_BTN_OLD = '`<div style="font-size:13px;color:var(--t2);margin-bottom:10px">${bancos.length} banco(s) operam este convênio:</div>`'
ADD_BTN_NEW_PREF = ('`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">'
                    '<span style="font-size:13px;color:var(--t2)">${bancos.length} banco(s) operam este convênio:</span>'
                    '${_admEhAdmin() ? `<button class="btn-acc btn-sm" onclick="admAbrirModalBanco(\\\'pref\\\', prefState.convenioAberto.convenio, null)">+ Adicionar banco</button>` : \'\'}'
                    '</div>`')
ADD_BTN_NEW_GOV = ('`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">'
                   '<span style="font-size:13px;color:var(--t2)">${bancos.length} banco(s) operam este convênio:</span>'
                   '${_admEhAdmin() ? `<button class="btn-acc btn-sm" onclick="admAbrirModalBanco(\\\'gov\\\', govState.convenioAberto.convenio, null)">+ Adicionar banco</button>` : \'\'}'
                   '</div>`')

# Substitui contextualmente (1a ocorrencia = pref, 2a = gov, ou vice-versa). Vou achar com base no state_var anterior.
def replace_contextual(src, needle, replacement, near_marker):
    """Substitui a 1a ocorrencia de needle que apareca depois de near_marker."""
    near_idx = src.find(near_marker)
    if near_idx == -1:
        print(f'AVISO: near_marker não encontrado: {near_marker[:60]}')
        return src
    needle_idx = src.find(needle, near_idx)
    if needle_idx == -1:
        print(f'AVISO: needle não encontrado após near_marker')
        return src
    return src[:needle_idx] + replacement + src[needle_idx + len(needle):]

src = replace_contextual(src, ADD_BTN_OLD, ADD_BTN_NEW_PREF, 'function renderPrefConvenioDetalhe')
src = replace_contextual(src, ADD_BTN_OLD, ADD_BTN_NEW_GOV, 'function renderGovConvenioDetalhe')

# Anexa renderAdminBancoModal() no final dos retornos das funcoes detalhe
# Procura a ultima linha "  return h;" de renderPrefConvenioDetalhe e renderGovConvenioDetalhe
# e prefixa com "h += renderAdminBancoModal();"
def append_modal_to_detalhe(src, func_name):
    # Encontra a função
    idx = src.find('function ' + func_name + '(')
    if idx == -1:
        print(f'AVISO: função {func_name} não encontrada')
        return src
    # Encontra a próxima ocorrência de "  return h;\n}" que pertence à função
    # Como a função tem uns 40-100 linhas, busca até ~6000 chars depois
    end_idx = src.find('  return h;\n}', idx, idx + 8000)
    if end_idx == -1:
        print(f'AVISO: return h; não encontrado em {func_name}')
        return src
    if 'h += renderAdminBancoModal();' in src[max(idx, end_idx-200):end_idx]:
        print(f'Modal já anexado em {func_name}')
        return src
    insertion = '  h += renderAdminBancoModal();\n'
    src = src[:end_idx] + insertion + src[end_idx:]
    print(f'Modal anexado em {func_name}')
    return src

src = append_modal_to_detalhe(src, 'renderPrefConvenioDetalhe')
src = append_modal_to_detalhe(src, 'renderGovConvenioDetalhe')

HTML.write_text(src, encoding='utf-8')
print(f'\nSALVO. Antes: {orig:,} bytes -> Depois: {len(src):,} bytes ({len(src)-orig:+,})')
