"""
Fix: re-injeta funcoes de holerite que foram removidas no refator UI.
prefOnArquivo, prefLimparHolerite, prefAnalisarHolerite (e equivalentes gov).
"""
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent.parent.parent
HTML = ROOT / 'index.html'

src = HTML.read_text(encoding='utf-8')
orig = len(src)

# ── PREFEITURAS — insere antes de "function renderPrefHolerite" ──
PREF_FUNCS = '''function prefLimparHolerite(){
  prefState.arquivoBase64 = null; prefState.arquivoNome = null;
  prefState.arquivoTipo = null; prefState.arquivoTamanho = 0;
  prefState.resultadoHol = null; prefState.errHol = null;
  renderApp();
}

async function prefOnArquivo(input){
  const f = input.files && input.files[0];
  if(!f){ return; }
  if(f.size > 10*1024*1024){ alert('Arquivo > 10MB. Reduza ou comprima.'); return; }
  const tipo = f.type;
  const ok = tipo === 'application/pdf' || tipo.startsWith('image/');
  if(!ok){ alert('Tipo nao suportado. Use PDF ou imagem (JPG/PNG/WEBP).'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const b64 = String(dataUrl).split(',')[1] || '';
    prefState.arquivoBase64 = b64;
    prefState.arquivoNome = f.name;
    prefState.arquivoTipo = tipo;
    prefState.arquivoTamanho = f.size;
    prefState.errHol = null; prefState.resultadoHol = null;
    renderApp();
  };
  reader.onerror = () => { alert('Falha ao ler arquivo'); };
  reader.readAsDataURL(f);
}

async function prefAnalisarHolerite(){
  if(!prefState.arquivoBase64){ alert('Selecione um arquivo de holerite primeiro.'); return; }
  prefState.loadingHol = true; prefState.errHol = null; prefState.resultadoHol = null; renderApp();
  try{
    const payload = {
      action: 'analisarHolerite',
      arquivo_base64: prefState.arquivoBase64,
      arquivo_nome: prefState.arquivoNome,
      arquivo_tipo: prefState.arquivoTipo,
    };
    if(prefState.convenioForcadoSlug) payload.convenio_slug = prefState.convenioForcadoSlug;
    const r = await apiFetch('/api/pref',{method:'POST',body:JSON.stringify(payload)});
    const d = await r.json();
    if(!d.ok) throw new Error(d.error||'Falha');
    prefState.resultadoHol = d;
  }catch(e){ prefState.errHol = e.message; }
  prefState.loadingHol = false; renderApp();
}

'''

# ── GOVERNOS — insere antes de "function renderGovHolerite" ──
GOV_FUNCS = '''function govLimparHolerite(){
  govState.arquivoBase64 = null; govState.arquivoNome = null;
  govState.arquivoTipo = null; govState.arquivoTamanho = 0;
  govState.resultadoHol = null; govState.errHol = null;
  renderApp();
}

async function govOnArquivo(input){
  const f = input.files && input.files[0];
  if(!f){ return; }
  if(f.size > 10*1024*1024){ alert('Arquivo > 10MB. Reduza ou comprima.'); return; }
  const tipo = f.type;
  const ok = tipo === 'application/pdf' || tipo.startsWith('image/');
  if(!ok){ alert('Tipo nao suportado. Use PDF ou imagem (JPG/PNG/WEBP).'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const b64 = String(dataUrl).split(',')[1] || '';
    govState.arquivoBase64 = b64;
    govState.arquivoNome = f.name;
    govState.arquivoTipo = tipo;
    govState.arquivoTamanho = f.size;
    govState.errHol = null; govState.resultadoHol = null;
    renderApp();
  };
  reader.onerror = () => { alert('Falha ao ler arquivo'); };
  reader.readAsDataURL(f);
}

async function govAnalisarHolerite(){
  if(!govState.arquivoBase64){ alert('Selecione um arquivo de holerite primeiro.'); return; }
  govState.loadingHol = true; govState.errHol = null; govState.resultadoHol = null; renderApp();
  try{
    const payload = {
      action: 'analisarHolerite',
      arquivo_base64: govState.arquivoBase64,
      arquivo_nome: govState.arquivoNome,
      arquivo_tipo: govState.arquivoTipo,
    };
    if(govState.convenioForcadoSlug) payload.convenio_slug = govState.convenioForcadoSlug;
    const r = await apiFetch('/api/gov',{method:'POST',body:JSON.stringify(payload)});
    const d = await r.json();
    if(!d.ok) throw new Error(d.error||'Falha');
    govState.resultadoHol = d;
  }catch(e){ govState.errHol = e.message; }
  govState.loadingHol = false; renderApp();
}

'''

def inject_before(src, target, code, label):
    if 'async function ' + target.replace('function ','').strip() in src or \
       'function ' + target.replace('function ','').strip() in src:
        # ja existe — nao injeta
        # Mas precisamos confirmar mais especifico
        pass
    # Acha posicao do target
    idx = src.find(target)
    if idx == -1:
        print(f'[{label}] target nao encontrado: {target!r}')
        return src, False
    return src[:idx] + code + src[idx:], True

# Confirma que as funcs realmente nao existem ainda
def has_func(src, name):
    return re.search(rf'^(async )?function {name}\s*\(', src, re.MULTILINE) is not None

needs_pref = not all(has_func(src, f) for f in ['prefOnArquivo','prefLimparHolerite','prefAnalisarHolerite'])
needs_gov  = not all(has_func(src, f) for f in ['govOnArquivo','govLimparHolerite','govAnalisarHolerite'])
print('Falta pref:', needs_pref, '| Falta gov:', needs_gov)

if needs_pref:
    src, ok = inject_before(src, 'function renderPrefHolerite()', PREF_FUNCS, 'PREF')
    print('PREF funcs injetadas:', ok)

if needs_gov:
    src, ok = inject_before(src, 'function renderGovHolerite()', GOV_FUNCS, 'GOV')
    print('GOV funcs injetadas:', ok)

HTML.write_text(src, encoding='utf-8')
print(f'\nSALVO. Antes: {orig:,} bytes -> Depois: {len(src):,} bytes (delta {len(src)-orig:+,})')
