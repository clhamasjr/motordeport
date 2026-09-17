"""
04_diff_catalogo.py — Mostra o que mudou no catalogo FEDERAL entre a versao
anterior (lida do git) e a atual (scripts/fed/convenios.json).

Roda DEPOIS do 03_clean_lev.py e ANTES de commitar. O resultado e o que se
mostra pro dono aprovar (bancos que entram/saem, suspensoes, taxas, margens).

Uso:
  python scripts/fed/04_diff_catalogo.py                  # compara com HEAD (ultimo commit)
  python scripts/fed/04_diff_catalogo.py --old-ref HEAD~1 # compara com o commit anterior
  python scripts/fed/04_diff_catalogo.py --old antigo.json
"""
import sys, json, subprocess, argparse, re
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
NEW_PATH = HERE / 'convenios.json'
REL = 'scripts/fed/convenios.json'

ap = argparse.ArgumentParser()
ap.add_argument('--old', help='caminho de um convenios.json antigo')
ap.add_argument('--old-ref', default='HEAD', help='ref git de onde ler o antigo (default: HEAD)')
args = ap.parse_args()

if args.old:
    old = json.loads(Path(args.old).read_text(encoding='utf-8'))
    old_label = args.old
else:
    r = subprocess.run(['git', '-C', str(ROOT), 'show', f'{args.old_ref}:{REL}'], capture_output=True)
    if r.returncode != 0:
        print('Falha ao ler a versao antiga do git:', r.stderr.decode('utf-8', 'replace')[:300])
        sys.exit(1)
    old = json.loads(r.stdout.decode('utf-8'))
    old_label = f'git {args.old_ref}'
new = json.loads(NEW_PATH.read_text(encoding='utf-8'))

by_slug = lambda d: {c['slug']: c for c in d['convenios']}
bmap = lambda conv: {b['slug']: b for b in conv['bancos']}
oc, nc = by_slug(old), by_slug(new)

def fmt_pct(v):
    return '—' if v is None else f'{v*100:.2f}%'.replace('.', ',')

print('=' * 72)
print(f'DIFF CATALOGO FEDERAL — antigo ({old_label}) -> novo ({NEW_PATH.name})')
print('=' * 72)
tot_old = sum(len(c['bancos']) for c in old['convenios'])
tot_new = sum(len(c['bancos']) for c in new['convenios'])
print(f'convenios: {len(oc)} -> {len(nc)} | relacoes banco x convenio: {tot_old} -> {tot_new} | '
      f'bancos unicos: {len(old.get("bancos_unicos", []))} -> {len(new.get("bancos_unicos", []))}')

mudou_algo = False
for slug, cn in nc.items():
    co = oc.get(slug)
    print(f"\n### {cn['nome']}  [{cn.get('orgao')}/{cn.get('operacao_tipo')}]")
    if not co:
        print('   (CONVENIO NOVO)'); mudou_algo = True; continue
    bo, bn = bmap(co), bmap(cn)
    entraram = [s for s in bn if s not in bo]
    sairam = [s for s in bo if s not in bn]
    print(f'   bancos: {len(bo)} -> {len(bn)}')
    if entraram:
        mudou_algo = True
        print('   + ENTRARAM: ' + ', '.join(bn[s]['nome'] + (' [SUSPENSO]' if bn[s]['suspenso'] else '') for s in entraram))
    if sairam:
        mudou_algo = True
        print('   - SAIRAM:   ' + ', '.join(bo[s]['nome'] for s in sairam))
    for s in bn:
        if s not in bo: continue
        a, b = bo[s], bn[s]
        chg = []
        if a['suspenso'] != b['suspenso']:
            chg.append('REATIVADO' if a['suspenso'] and not b['suspenso'] else 'SUSPENSO')
        if a.get('operacoes') != b.get('operacoes'):
            ops = lambda o: '/'.join(k for k, v in (o or {}).items() if v) or 'nenhuma'
            chg.append(f"operacoes {ops(a.get('operacoes'))} -> {ops(b.get('operacoes'))}")
        if a.get('taxa_minima_port') != b.get('taxa_minima_port'):
            chg.append(f"taxa port {fmt_pct(a.get('taxa_minima_port'))} -> {fmt_pct(b.get('taxa_minima_port'))}")
        if (a.get('idade_min'), a.get('idade_max')) != (b.get('idade_min'), b.get('idade_max')):
            chg.append(f"idade {a.get('idade_min')}-{a.get('idade_max')} -> {b.get('idade_min')}-{b.get('idade_max')}")
        if a.get('margem_utilizavel') != b.get('margem_utilizavel'):
            chg.append(f"margem {fmt_pct(a.get('margem_utilizavel'))} -> {fmt_pct(b.get('margem_utilizavel'))}")
        if chg:
            mudou_algo = True
            print(f"     ~ {b['nome']}: " + '; '.join(chg))

for slug in oc:
    if slug not in nc:
        mudou_algo = True
        print(f"\n### (CONVENIO REMOVIDO) {oc[slug]['nome']}")

full = json.dumps(new, ensure_ascii=False)
lev = len(re.findall(r'\blev\b', full, re.I)) + full.lower().count('levnegocios')
print(f"\nMencoes a LEV no catalogo novo: {lev}  {'(OK)' if lev == 0 else '(ATENCAO: rodar 03_clean_lev.py)'}")
if not mudou_algo:
    print('\nNenhuma mudanca de banco/regra detectada entre as duas versoes.')
