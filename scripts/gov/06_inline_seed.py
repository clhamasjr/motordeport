"""
Le gov_seed.json e gera arquivos com cada chunk de 100 registros pre-formatado
como 1 chamada SELECT gov_seed_apply_chunk(jsonb).

Cada arquivo tera SQL pequeno o suficiente pra caber em uma chamada execute_sql.
"""
import json, sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent.parent.parent
SRC = ROOT / 'gov_seed.json'
OUT = Path(__file__).parent / 'inline_chunks'
OUT.mkdir(exist_ok=True)

# Limpa
for f in OUT.glob('*.sql'): f.unlink()

data = json.loads(SRC.read_text(encoding='utf-8'))

# Monta array compacto de relacoes
relacoes = []
for c in data['convenios']:
    for b in c['bancos']:
        rel = {
            'banco_slug': b['slug'],
            'convenio_slug': c['slug'],
            'opera_novo': bool(b.get('operacoes',{}).get('novo')),
            'opera_refin': bool(b.get('operacoes',{}).get('refin')),
            'opera_port': bool(b.get('operacoes',{}).get('port')),
            'opera_cartao': bool(b.get('operacoes',{}).get('cartao')),
            'suspenso': bool(b.get('suspenso')),
            'margem_utilizavel': b.get('margem_utilizavel'),
            'idade_min': b.get('idade_min'),
            'idade_max': b.get('idade_max'),
            'taxa_minima_port': b.get('taxa_minima_port'),
            'data_corte': b.get('atributos',{}).get('data_corte'),
            'valor_minimo': b.get('atributos',{}).get('valor_minimo'),
            'qtd_contratos': b.get('atributos',{}).get('qtd_contratos'),
            'atributos': b.get('atributos', {}),
            'atributos_brutos': b.get('atributos_brutos', []),
        }
        relacoes.append(rel)

print(f'Total relacoes: {len(relacoes)}')

# Quebra em chunks de 25 (cada chunk fica em ~150KB)
CHUNK = 25
for i in range(0, len(relacoes), CHUNK):
    chunk = relacoes[i:i+CHUNK]
    payload = json.dumps(chunk, ensure_ascii=False, separators=(',',':'))
    # Escapa aspas simples pra SQL
    payload_sql = payload.replace("'", "''")
    sql = f"select gov_seed_apply_chunk('{payload_sql}'::jsonb);"
    fn = OUT / f'chunk_{i//CHUNK:02d}.sql'
    fn.write_text(sql, encoding='utf-8')
    print(f'  chunk_{i//CHUNK:02d}.sql: {len(sql):>10,} bytes ({len(chunk)} registros)')

print(f'\nTotal: {(len(relacoes) + CHUNK - 1) // CHUNK} chunks gerados em {OUT}')
