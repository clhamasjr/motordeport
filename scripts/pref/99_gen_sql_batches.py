"""
Gera arquivos SQL em batches a partir de pref_seed.json para serem executados
via Supabase MCP execute_sql. Saida em scripts/pref/sql_batches/.
"""
import json, sys, os
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent.parent.parent
SEED = ROOT / 'pref_seed.json'
OUT = Path(__file__).parent / 'sql_batches'
OUT.mkdir(exist_ok=True)

def sql_str(s):
    if s is None: return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"

def sql_bool(b):
    return 'true' if b else 'false'

def sql_num(n):
    if n is None: return 'NULL'
    return str(n)

def sql_jsonb(obj):
    if obj is None: return "'{}'::jsonb"
    j = json.dumps(obj, ensure_ascii=False)
    return "'" + j.replace("'", "''") + "'::jsonb"

data = json.loads(SEED.read_text(encoding='utf-8'))

# ── 1) bancos.sql ──
bancos = data['bancos_unicos']
parts = ['INSERT INTO pref_bancos (slug, nome) VALUES']
vals = [f"({sql_str(b['slug'])}, {sql_str(b['nome'])})" for b in bancos]
parts.append(',\n'.join(vals))
parts.append('ON CONFLICT (slug) DO UPDATE SET nome=EXCLUDED.nome;')
(OUT / '01_bancos.sql').write_text('\n'.join(parts), encoding='utf-8')
print(f'01_bancos.sql: {len(bancos)} bancos')

# ── 2) convenios.sql (em batches de 200) ──
convs = data['convenios']
BATCH = 200
total_files = 0
for i in range(0, len(convs), BATCH):
    batch = convs[i:i+BATCH]
    parts = ['INSERT INTO pref_convenios (slug, nome, uf, estado_nome, municipio, tipo, sheet_origem, atualizado_em) VALUES']
    vals = []
    for c in batch:
        vals.append(
            f"({sql_str(c['slug'])}, "
            f"{sql_str(c['nome'])}, "
            f"{sql_str(c.get('uf'))}, "
            f"{sql_str(c.get('estado_nome'))}, "
            f"{sql_str(c.get('municipio'))}, "
            f"{sql_str(c.get('tipo'))}, "
            f"{sql_str(c.get('sheet'))}, "
            f"{sql_str(data['meta'].get('gerado_em'))}::date)"
        )
    parts.append(',\n'.join(vals))
    parts.append('ON CONFLICT (slug) DO UPDATE SET nome=EXCLUDED.nome, uf=EXCLUDED.uf, estado_nome=EXCLUDED.estado_nome, municipio=EXCLUDED.municipio, tipo=EXCLUDED.tipo, sheet_origem=EXCLUDED.sheet_origem;')
    fn = OUT / f'02_convenios_{i//BATCH+1:02d}.sql'
    fn.write_text('\n'.join(parts), encoding='utf-8')
    total_files += 1
print(f'02_convenios_*.sql: {len(convs)} convenios em {total_files} batch(es)')

# ── 3) banco_convenio.sql (em batches de 100 — JSONB pesado) ──
todas_rels = []
for c in convs:
    for b in c.get('bancos', []):
        ops = b.get('operacoes', {})
        attrs = b.get('atributos', {})
        todas_rels.append({
            'banco_slug': b['slug'],
            'conv_slug': c['slug'],
            'opera_novo': ops.get('novo', False),
            'opera_refin': ops.get('refin', False),
            'opera_port': ops.get('port', False),
            'opera_cartao': ops.get('cartao', False),
            'suspenso': b.get('suspenso', False),
            'margem_utilizavel': b.get('margem_utilizavel'),
            'idade_min': b.get('idade_min'),
            'idade_max': b.get('idade_max'),
            'taxa_minima_port': b.get('taxa_minima_port'),
            'data_corte': attrs.get('data_corte'),
            'valor_minimo': attrs.get('valor_minimo'),
            'qtd_contratos': attrs.get('qtd_contratos'),
            'atributos': attrs,
            'atributos_brutos': b.get('atributos_brutos', []),
        })

REL_BATCH = 100
total_files = 0
for i in range(0, len(todas_rels), REL_BATCH):
    batch = todas_rels[i:i+REL_BATCH]
    parts = ['''WITH rels AS (
SELECT * FROM (VALUES''']
    vals = []
    for r in batch:
        vals.append(
            f"({sql_str(r['banco_slug'])}, "
            f"{sql_str(r['conv_slug'])}, "
            f"{sql_bool(r['opera_novo'])}, "
            f"{sql_bool(r['opera_refin'])}, "
            f"{sql_bool(r['opera_port'])}, "
            f"{sql_bool(r['opera_cartao'])}, "
            f"{sql_bool(r['suspenso'])}, "
            f"{sql_num(r['margem_utilizavel'])}::numeric, "
            f"{sql_num(r['idade_min'])}::smallint, "
            f"{sql_num(r['idade_max'])}::smallint, "
            f"{sql_num(r['taxa_minima_port'])}::numeric, "
            f"{sql_str(r['data_corte'])}, "
            f"{sql_str(r['valor_minimo'])}, "
            f"{sql_str(r['qtd_contratos'])}, "
            f"{sql_jsonb(r['atributos'])}, "
            f"{sql_jsonb(r['atributos_brutos'])})"
        )
    parts.append(',\n'.join(vals))
    parts.append(''') AS t(
  banco_slug, conv_slug,
  opera_novo, opera_refin, opera_port, opera_cartao,
  suspenso, margem_utilizavel, idade_min, idade_max, taxa_minima_port,
  data_corte, valor_minimo, qtd_contratos, atributos, atributos_brutos
))
INSERT INTO pref_banco_convenio (
  banco_id, convenio_id,
  opera_novo, opera_refin, opera_port, opera_cartao,
  suspenso, margem_utilizavel, idade_min, idade_max, taxa_minima_port,
  data_corte, valor_minimo, qtd_contratos, atributos, atributos_brutos
)
SELECT b.id, c.id,
  r.opera_novo, r.opera_refin, r.opera_port, r.opera_cartao,
  r.suspenso, r.margem_utilizavel, r.idade_min, r.idade_max, r.taxa_minima_port,
  r.data_corte, r.valor_minimo, r.qtd_contratos, r.atributos, r.atributos_brutos
FROM rels r
JOIN pref_bancos b ON b.slug = r.banco_slug
JOIN pref_convenios c ON c.slug = r.conv_slug
ON CONFLICT (banco_id, convenio_id) DO UPDATE SET
  opera_novo = EXCLUDED.opera_novo,
  opera_refin = EXCLUDED.opera_refin,
  opera_port = EXCLUDED.opera_port,
  opera_cartao = EXCLUDED.opera_cartao,
  suspenso = EXCLUDED.suspenso,
  margem_utilizavel = EXCLUDED.margem_utilizavel,
  idade_min = EXCLUDED.idade_min,
  idade_max = EXCLUDED.idade_max,
  taxa_minima_port = EXCLUDED.taxa_minima_port,
  data_corte = EXCLUDED.data_corte,
  valor_minimo = EXCLUDED.valor_minimo,
  qtd_contratos = EXCLUDED.qtd_contratos,
  atributos = EXCLUDED.atributos,
  atributos_brutos = EXCLUDED.atributos_brutos;''')
    fn = OUT / f'03_rels_{i//REL_BATCH+1:02d}.sql'
    fn.write_text('\n'.join(parts), encoding='utf-8')
    total_files += 1
print(f'03_rels_*.sql: {len(todas_rels)} relacoes em {total_files} batch(es)')

# Total tamanho
total_bytes = sum(p.stat().st_size for p in OUT.glob('*.sql'))
print(f'\nTotal: {total_bytes:,} bytes em {len(list(OUT.glob("*.sql")))} arquivos')
