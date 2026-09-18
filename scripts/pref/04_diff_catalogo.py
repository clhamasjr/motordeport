"""
04_diff_catalogo.py — Mostra o que mudou no catalogo de PREFEITURAS entre a versao
publicada (pref_seed.json lido do git) e a nova (pref_seed.json na raiz, recem-gerado).

Roda DEPOIS do 05_compact_seed.py e ANTES de commitar. E o que se mostra pro dono
aprovar (convenios que entram/saem, bancos que entram/saem, suspensoes, taxas, margens).
Compara os SEEDS (nao o convenios.json) porque scripts/pref/convenios.json nao e versionado.

Uso:
  python scripts/pref/04_diff_catalogo.py                  # compara com HEAD (ultimo commit)
  python scripts/pref/04_diff_catalogo.py --old-ref HEAD~1
  python scripts/pref/04_diff_catalogo.py --old antigo.json
  python scripts/pref/04_diff_catalogo.py --resumo         # so totais + convenios que entram/saem
  python scripts/pref/04_diff_catalogo.py --uf SP          # detalha so uma UF
"""
import sys, json, subprocess, argparse, re
from collections import Counter
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
NEW_PATH = ROOT / 'pref_seed.json'
REL = 'pref_seed.json'

ap = argparse.ArgumentParser()
ap.add_argument('--old', help='caminho de um pref_seed.json antigo')
ap.add_argument('--old-ref', default='HEAD', help='ref git de onde ler o antigo (default: HEAD)')
ap.add_argument('--resumo', action='store_true', help='so totais e convenios que entram/saem')
ap.add_argument('--uf', help='detalha so os convenios dessa UF')
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
lab = lambda c: f"{c['nome']} [{c.get('uf') or '?'}]"

print('=' * 72)
print(f"DIFF CATALOGO PREFEITURAS — antigo ({old_label}, gerado {old['meta'].get('gerado_em')}) -> novo (gerado {new['meta'].get('gerado_em')})")
print('=' * 72)
tot_old = sum(len(c['bancos']) for c in old['convenios']); tot_new = sum(len(c['bancos']) for c in new['convenios'])
print(f'convenios: {len(oc)} -> {len(nc)} | relacoes banco x convenio: {tot_old} -> {tot_new} | '
      f'bancos unicos: {len(old.get("bancos_unicos", []))} -> {len(new.get("bancos_unicos", []))}')

# por UF
uf_old = Counter(c.get('uf') or '?' for c in old['convenios']); uf_new = Counter(c.get('uf') or '?' for c in new['convenios'])
ufs = sorted(set(uf_old) | set(uf_new))
print('por UF: ' + ', '.join(f"{u} {uf_old.get(u,0)}->{uf_new.get(u,0)}" for u in ufs if uf_old.get(u) != uf_new.get(u)) or 'por UF: sem mudanca de contagem')

novos = [s for s in nc if s not in oc]; removidos = [s for s in oc if s not in nc]
if novos:
    print(f'\n+ CONVENIOS NOVOS ({len(novos)}):')
    for s in novos: print(f"   {lab(nc[s])} ({len(nc[s]['bancos'])} bancos)  aba={nc[s]['sheet']}")
if removidos:
    print(f'\n- CONVENIOS QUE SAIRAM ({len(removidos)}):')
    for s in removidos: print(f"   {lab(oc[s])} ({len(oc[s]['bancos'])} bancos)  aba={oc[s]['sheet']}")
    print('  (no reseed modo "planilha" com excluir_fora_da_planilha eles SAO excluidos do Supabase; no conservador ficam como estao)')

sem_uf = [c['nome'] for c in new['convenios'] if not c.get('uf')]
if sem_uf:
    print(f'\n! CONVENIOS SEM UF ({len(sem_uf)}) — ajustar UF_SEPARATORS no 02_parse.py: ' + ', '.join(sem_uf))

# bancos unicos que entram/saem no catalogo inteiro
bo_all = {b['slug']: b['nome'] for b in old.get('bancos_unicos', [])}; bn_all = {b['slug']: b['nome'] for b in new.get('bancos_unicos', [])}
if set(bn_all) - set(bo_all): print('\n+ BANCOS NOVOS NO CATALOGO: ' + ', '.join(bn_all[s] for s in bn_all if s not in bo_all))
if set(bo_all) - set(bn_all): print('- BANCOS QUE SUMIRAM DO CATALOGO: ' + ', '.join(bo_all[s] for s in bo_all if s not in bn_all))

mudou = {'entraram': 0, 'sairam': 0, 'suspenso': 0, 'reativado': 0, 'taxa': 0, 'margem': 0, 'idade': 0, 'operacoes': 0, 'convenios_alterados': 0}
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
        mudou['convenios_alterados'] += 1
        if args.uf and (cn.get('uf') or '?') != args.uf.upper(): continue
        linhas.append(f"\n### {lab(cn)}  bancos {len(bo)} -> {len(bn)}")
        linhas.extend(det)

print(f"\nRESUMO das mudancas em convenios que ja existiam ({mudou['convenios_alterados']} convenios alterados): "
      f"bancos entraram {mudou['entraram']} | sairam {mudou['sairam']} | suspensos {mudou['suspenso']} | reativados {mudou['reativado']} | "
      f"taxa port {mudou['taxa']} | margem {mudou['margem']} | idade {mudou['idade']} | operacoes {mudou['operacoes']}")
if not args.resumo:
    print('\n'.join(linhas) if linhas else '\nNenhuma mudanca de banco/regra nos convenios que ja existiam.')

full = json.dumps(new, ensure_ascii=False)
lev = len(re.findall(r'\blev\b', full, re.I)) + full.lower().count('levnegocios')
print(f"\nMencoes a LEV no catalogo novo: {lev}")
