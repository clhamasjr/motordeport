"""
04_diff_catalogo.py — Mostra o que mudou no catalogo de GOVERNOS entre a versao
publicada (gov_seed.json lido do git) e a nova (gov_seed.json na raiz, recem-gerado).

Roda DEPOIS do 05_compact_seed.py e ANTES de commitar. E o que se mostra pro dono
aprovar (convenios que entram/saem, bancos que entram/saem, suspensoes, taxas, margens).
Compara os SEEDS (nao o convenios.json) porque scripts/gov/convenios.json nao e versionado.

Uso:
  python scripts/gov/04_diff_catalogo.py                  # compara com HEAD (ultimo commit)
  python scripts/gov/04_diff_catalogo.py --old-ref HEAD~1
  python scripts/gov/04_diff_catalogo.py --old antigo.json
  python scripts/gov/04_diff_catalogo.py --resumo         # so totais + convenios que entram/saem
"""
import sys, json, subprocess, argparse, re
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
NEW_PATH = ROOT / 'gov_seed.json'
REL = 'gov_seed.json'

ap = argparse.ArgumentParser()
ap.add_argument('--old', help='caminho de um gov_seed.json antigo')
ap.add_argument('--old-ref', default='HEAD', help='ref git de onde ler o antigo (default: HEAD)')
ap.add_argument('--resumo', action='store_true', help='so totais e convenios que entram/saem')
args = ap.parse_args()

if args.old:
    old = json.loads(Path(args.old).read_text(encoding='utf-8')); old_label = args.old
else:
    r = subprocess.run(['git', '-C', str(ROOT), 'show', f'{args.old_ref}:{REL}'], capture_output=True)
    if r.returncode != 0:
        print('Falha ao ler a versao antiga do git:', r.stderr.decode('utf-8', 'replace')[:300]); sys.exit(1)
    old = json.loads(r.stdout.decode('utf-8')); old_label = f'git {args.old_ref}'
new = json.loads(NEW_PATH.read_text(encoding='utf-8'))

by_slug = lambda d: {c['slug']: c for c in d['convenios']}
bmap = lambda conv: {b['slug']: b for b in conv['bancos']}
oc, nc = by_slug(old), by_slug(new)
fmt_pct = lambda v: '—' if v is None else f'{v*100:.2f}%'.replace('.', ',')
ops = lambda o: '/'.join(k for k, v in (o or {}).items() if v) or 'nenhuma'

print('=' * 72)
print(f"DIFF CATALOGO GOVERNOS — antigo ({old_label}, gerado {old['meta'].get('gerado_em')}) -> novo (gerado {new['meta'].get('gerado_em')})")
print('=' * 72)
tot_old = sum(len(c['bancos']) for c in old['convenios']); tot_new = sum(len(c['bancos']) for c in new['convenios'])
print(f'convenios: {len(oc)} -> {len(nc)} | relacoes banco x convenio: {tot_old} -> {tot_new} | '
      f'bancos unicos: {len(old.get("bancos_unicos", []))} -> {len(new.get("bancos_unicos", []))}')

novos = [s for s in nc if s not in oc]; removidos = [s for s in oc if s not in nc]
if novos:
    print(f'\n+ CONVENIOS NOVOS ({len(novos)}): ' + ', '.join(f"{nc[s]['nome']} [{nc[s].get('uf') or '?'}] ({len(nc[s]['bancos'])} bancos)" for s in novos))
if removidos:
    print(f'\n- CONVENIOS QUE SAIRAM ({len(removidos)}): ' + ', '.join(f"{oc[s]['nome']} [{oc[s].get('uf') or '?'}]" for s in removidos))
    print('  (no reseed eles NAO sao apagados do Supabase: continuam como estao, sem relacoes novas)')

sem_uf = [c['nome'] for c in new['convenios'] if not c.get('uf')]
if sem_uf:
    print(f'\n! CONVENIOS SEM UF ({len(sem_uf)}) — ajustar detect_uf no 02_parse.py: ' + ', '.join(sem_uf))

mudou = {'entraram': 0, 'sairam': 0, 'suspenso': 0, 'reativado': 0, 'taxa': 0, 'margem': 0, 'idade': 0, 'operacoes': 0}
linhas = []
for slug, cn in nc.items():
    co = oc.get(slug)
    if not co: continue
    bo, bn = bmap(co), bmap(cn)
    entraram = [s for s in bn if s not in bo]; sairam = [s for s in bo if s not in bn]
    det = []
    if entraram:
        mudou['entraram'] += len(entraram)
        det.append('   + ENTRARAM: ' + ', '.join(bn[s]['nome'] + (' [SUSPENSO]' if bn[s]['suspenso'] else '') for s in entraram))
    if sairam:
        mudou['sairam'] += len(sairam)
        det.append('   - SAIRAM:   ' + ', '.join(bo[s]['nome'] for s in sairam))
    for s in bn:
        if s not in bo: continue
        a, b = bo[s], bn[s]; chg = []
        if a['suspenso'] != b['suspenso']:
            if a['suspenso']: chg.append('REATIVADO'); mudou['reativado'] += 1
            else: chg.append('SUSPENSO'); mudou['suspenso'] += 1
        if a.get('operacoes') != b.get('operacoes'):
            chg.append(f"operacoes {ops(a.get('operacoes'))} -> {ops(b.get('operacoes'))}"); mudou['operacoes'] += 1
        if a.get('taxa_minima_port') != b.get('taxa_minima_port'):
            chg.append(f"taxa port {fmt_pct(a.get('taxa_minima_port'))} -> {fmt_pct(b.get('taxa_minima_port'))}"); mudou['taxa'] += 1
        if (a.get('idade_min'), a.get('idade_max')) != (b.get('idade_min'), b.get('idade_max')):
            chg.append(f"idade {a.get('idade_min')}-{a.get('idade_max')} -> {b.get('idade_min')}-{b.get('idade_max')}"); mudou['idade'] += 1
        if a.get('margem_utilizavel') != b.get('margem_utilizavel'):
            chg.append(f"margem {fmt_pct(a.get('margem_utilizavel'))} -> {fmt_pct(b.get('margem_utilizavel'))}"); mudou['margem'] += 1
        if chg: det.append(f"     ~ {b['nome']}: " + '; '.join(chg))
    if det:
        linhas.append(f"\n### {cn['nome']} [{cn.get('uf') or '?'}]  bancos {len(bo)} -> {len(bn)}")
        linhas.extend(det)

print(f"\nRESUMO das mudancas em convenios que ja existiam: bancos entraram {mudou['entraram']} | sairam {mudou['sairam']} | "
      f"suspensos {mudou['suspenso']} | reativados {mudou['reativado']} | taxa port {mudou['taxa']} | margem {mudou['margem']} | "
      f"idade {mudou['idade']} | operacoes {mudou['operacoes']}")
if not args.resumo:
    print('\n'.join(linhas) if linhas else '\nNenhuma mudanca de banco/regra nos convenios que ja existiam.')

full = json.dumps(new, ensure_ascii=False)
lev = len(re.findall(r'\blev\b', full, re.I)) + full.lower().count('levnegocios')
print(f"\nMencoes a LEV no catalogo novo: {lev}")
