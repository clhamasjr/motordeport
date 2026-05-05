"""
Gera versao enxuta do convenios.json pra empacotar como seed publico no FlowForce.
Remove atributos_brutos (redundante com atributos+labels gerados em runtime).
Saida: public/gov_seed.json
"""
import json, sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent.parent.parent
SRC = Path(__file__).parent / 'convenios.json'
OUT = ROOT / 'gov_seed.json'  # raiz do repo - servido como estatico no Vercel

data = json.loads(SRC.read_text(encoding='utf-8'))

# Mapa label original por slug (1a ocorrencia ganha) — pra preservar nomenclatura humana
labels_canonicos = {}
for c in data['convenios']:
    for b in c['bancos']:
        for ab in b.get('atributos_brutos', []):
            valor_correspondente = b['atributos'].get(ab.get('label_slug',''), None)
            # achar o slug correspondente: vamos comparar valor
            for slug, val in b['atributos'].items():
                if val == ab['valor'] and slug not in labels_canonicos:
                    labels_canonicos[slug] = ab['label']

# Versao enxuta
slim = {
    'meta': {
        **data['meta'],
        'versao_seed': '1',
        'gerado_em': '2026-05-04',
    },
    'labels': labels_canonicos,
    'bancos_unicos': data['bancos_unicos'],
    'convenios': []
}
for c in data['convenios']:
    bancos_slim = []
    for b in c['bancos']:
        bancos_slim.append({
            'slug': b['slug'],
            'nome': b['nome'],
            'suspenso': b['suspenso'],
            'operacoes': b['operacoes'],
            'idade_min': b['idade_min'],
            'idade_max': b['idade_max'],
            'margem_utilizavel': b['margem_utilizavel'],
            'taxa_minima_port': b['taxa_minima_port'],
            'atributos': b['atributos'],  # so o canonico
            # NAO incluimos atributos_brutos — labels vem do dicionario global
            'atributos_brutos': b.get('atributos_brutos', []),  # KEEP - precisamos no detalhe
        })
    slim['convenios'].append({
        'slug': c['slug'],
        'nome': c['nome'],
        'uf': c['uf'],
        'estado_nome': c['estado_nome'],
        'sheet': c['sheet'],
        'bancos': bancos_slim,
    })

# Salva compacto (sem indent)
OUT.write_text(json.dumps(slim, ensure_ascii=False, separators=(',',':')), encoding='utf-8')

original = SRC.stat().st_size
nova = OUT.stat().st_size
print(f'OK -> {OUT}')
print(f'  Original: {original:>10,} bytes ({original/1024/1024:.2f} MB)')
print(f'  Enxuto:   {nova:>10,} bytes ({nova/1024/1024:.2f} MB)')
print(f'  Reducao:  {(1-nova/original)*100:.0f}%')
