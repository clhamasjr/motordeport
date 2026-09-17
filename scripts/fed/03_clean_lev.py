"""
03_clean_lev.py — Remove TODA referencia a LEV (Lev Negocios / averbadora)
do catalogo federal, preservando ao maximo a regra do banco ao redor.

Roda DEPOIS do 02_parse.py e ANTES do 05_compact_seed.py:
    python scripts/fed/02_parse.py
    python scripts/fed/03_clean_lev.py     <-- este
    python scripts/fed/05_compact_seed.py

Reescreve scripts/fed/convenios.json in-place (limpo).

Regras de limpeza (linha a linha dentro de cada texto de label/valor):
  - "(parceiro ou LEV)"              -> "(parceiro)"
  - "LEV ou BANCO"                   -> "BANCO"
  - "* Verificar tambem Regra LEV *" -> removido
  - e-mails @levnegocios.com.br      -> removidos
  - linha que vira instrucao de e-mail orfa ("Solicitado via e-mail",
    "Solicita atraves do E-MAIL:", "via e-mail") apos o destino LEV sumir -> descartada
  - token "LEV"/"Lev" isolado        -> removido
  - se, apos limpar, label E valor ficarem sem conteudo util, o valor fica
    vazio mas o registro do atributo e mantido (a regra costuma estar no rotulo).
Motivo: a LhamasCred deixou de operar via averbadora LEV nos convenios federais.
"""
import sys, json, re
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

JSON_PATH = Path(__file__).parent / 'convenios.json'

EMAIL_LEV = re.compile(r'[\w.\-]*@levnegocios\.com\.br', re.I)
_norm = lambda s: re.sub(r'[^a-z0-9]', '', str(s).lower())
ORPHAN_EXACT = {
    'solicitadoviaemail', 'solicitaatravesdoemail', 'viaemail', 'via', 'solicitado', 'solicita',
    'solicitadoviaemailajuste', 'solicitaatravesdoemailajuste', 'solicitadoviaemailajustee',
    'solicitaatravesdo', 'solicitadovia', 'emissaoviaemail', 'reserva',
}

def _is_orphan_line(ln):
    n = _norm(ln)
    if n == '' or n in ORPHAN_EXACT:
        return True
    low = ln.strip().lower().rstrip(' .:;-')
    if re.search(r'(e-?mail)$', low):
        return True
    if re.search(r'(atrav[eé]s do)$', low):
        return True
    if re.search(r'^via$', low):
        return True
    return False

def _email_instruction_orphan(ln):
    low = ln.strip().lower()
    low = re.sub(r'\(\s*ajuste\s*\)', '', low)
    low = low.rstrip(' .:;-)(')
    if re.search(r'(via e-?mail|atrav[eé]s do e-?mail|solicitado via e-?mail)$', low):
        return True
    if re.search(r'^e-?mail$', low):
        return True
    return _norm(ln) in ORPHAN_EXACT

def strip_lev(text):
    """(novo, mudou) — remove mencoes LEV linha a linha, preservando o resto."""
    if text is None:
        return text, False
    original = str(text)
    out_lines = []
    for ln in re.split(r'\r?\n', original):
        if 'lev' not in ln.lower():
            out_lines.append(ln)
            continue
        new = ln
        new = re.sub(r'\*?\s*verificar\s+tamb[eé]m\s+(a\s+)?regra\s+lev\.?\s*\*?', ' ', new, flags=re.I)
        new = re.sub(r'\(\s*parceiro\s+ou\s+lev\s*\)', '(parceiro)', new, flags=re.I)
        new = re.sub(r'\bparceiro\s+ou\s+lev\b', 'parceiro', new, flags=re.I)
        new = re.sub(r'\blev\s+ou\s+banco\b', 'BANCO', new, flags=re.I)
        new = re.sub(r'e-?mail\s*:?\s*' + EMAIL_LEV.pattern, ' ', new, flags=re.I)
        new = EMAIL_LEV.sub(' ', new)
        new = re.sub(r'\bregra\s+lev\b', '', new, flags=re.I)
        new = re.sub(r'\b(na|pela|da|feita\s+pela)\s+lev\b', '', new, flags=re.I)
        new = re.sub(r'\blev\b', '', new, flags=re.I)
        new = re.sub(r'\(\s*\)', '', new)
        new = re.sub(r'\s{2,}', ' ', new).strip().strip(' :*,;()-')
        if _is_orphan_line(new):
            continue
        if new and re.search(r'[a-zA-Z0-9]', new):
            out_lines.append(new)
    if 'lev' in original.lower() and not any('@' in l for l in out_lines):
        out_lines = [l for l in out_lines if not _email_instruction_orphan(l)]
    novo = '\n'.join(l for l in out_lines if l.strip())
    novo = re.sub(r'\n{2,}', '\n', novo).strip()
    return novo, (novo != original)

def substantive(text):
    if text is None:
        return False
    t = str(text).strip()
    if t in ('', '-', '--', 'x', 'X'):
        return False
    if _is_orphan_line(t):
        return False
    return len(_norm(t)) > 3 or bool(re.search(r'\d', t))

def main():
    data = json.loads(JSON_PATH.read_text(encoding='utf-8'))
    stats = {'limpos': 0, 'labels': 0, 'valor_vazio': 0}

    for c in data['convenios']:
        for b in c['bancos']:
            novos = []
            for ab in b.get('atributos_brutos', []):
                lab0, val0 = ab.get('label', ''), ab.get('valor', '')
                if 'lev' not in (str(lab0) + ' ' + str(val0)).lower():
                    novos.append(ab)
                    continue
                lab, labchg = strip_lev(lab0)
                val, _ = strip_lev(val0)
                if labchg:
                    stats['labels'] += 1
                if not substantive(val) and substantive(lab):
                    stats['valor_vazio'] += 1
                stats['limpos'] += 1
                ab2 = dict(ab); ab2['label'] = lab; ab2['valor'] = val
                novos.append(ab2)
            b['atributos_brutos'] = novos
            novos_can = {}
            for slug, val0 in (b.get('atributos') or {}).items():
                if 'lev' not in str(val0).lower():
                    novos_can[slug] = val0
                    continue
                val, _ = strip_lev(val0)
                if substantive(val):
                    novos_can[slug] = val
            b['atributos'] = novos_can

    full = json.dumps(data, ensure_ascii=False)
    resto = len(re.findall(r'\blev\b', full, re.I)) + full.lower().count('levnegocios')
    JSON_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'OK -> {JSON_PATH}')
    print(f'  Campos com LEV limpos:            {stats["limpos"]}')
    print(f'  Rotulos ajustados:                {stats["labels"]}')
    print(f'  Valores esvaziados (regra no rotulo): {stats["valor_vazio"]}')
    print(f'  Ocorrencias de "lev" restantes:   {resto}')
    if resto:
        print('  ATENCAO: ainda restou "lev" — revisar!')
        sys.exit(1)

if __name__ == '__main__':
    main()
