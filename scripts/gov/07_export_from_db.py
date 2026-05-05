"""
Exporta o estado atual do banco vivo (gov_bancos + gov_convenios + gov_banco_convenio)
e gera novo gov_seed.json com TODAS as correcoes aplicadas (LEV->LHAMAS, sem
ITAU/MASTER/OLE, UFs corretos, nomes renomeados, etc).

Uso: precisa SUPABASE_URL e SUPABASE_SERVICE_KEY no env, OU passar via argumentos.
Como usuario nao quer expor credenciais, gera um arquivo SQL que o admin pode
copiar/colar no Supabase SQL Editor pra exportar via JSON e usar como seed.

Saida: scripts/gov/export_seed.sql (1 query unica que retorna o JSON pronto)
"""
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

OUT = Path(__file__).parent / 'export_seed.sql'

OUT.write_text("""-- Roda no Supabase SQL Editor pra exportar o estado atual como JSON.
-- Cole o resultado em gov_seed.json (raiz do repo) e faca push.

select jsonb_pretty(jsonb_build_object(
  'meta', jsonb_build_object(
    'fonte', 'export_from_db',
    'gerado_em', now()::date,
    'total_convenios', (select count(*) from gov_convenios),
    'total_bancos_unicos', (select count(*) from gov_bancos),
    'versao_seed', '2'
  ),
  'bancos_unicos', (
    select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'nome', nome) order by slug), '[]'::jsonb)
    from gov_bancos
  ),
  'convenios', (
    select coalesce(jsonb_agg(c order by c->>'slug'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'slug', cv.slug,
        'nome', cv.nome,
        'uf', cv.uf,
        'estado_nome', cv.estado_nome,
        'sheet', cv.sheet_origem,
        'bancos', coalesce(
          (select jsonb_agg(jsonb_build_object(
            'slug', b.slug,
            'nome', b.nome,
            'suspenso', bc.suspenso,
            'operacoes', jsonb_build_object('novo', bc.opera_novo, 'refin', bc.opera_refin, 'port', bc.opera_port, 'cartao', bc.opera_cartao),
            'idade_min', bc.idade_min,
            'idade_max', bc.idade_max,
            'margem_utilizavel', bc.margem_utilizavel,
            'taxa_minima_port', bc.taxa_minima_port,
            'atributos', bc.atributos,
            'atributos_brutos', bc.atributos_brutos
          ) order by b.nome) from gov_banco_convenio bc join gov_bancos b on b.id = bc.banco_id where bc.convenio_id = cv.id),
          '[]'::jsonb
        )
      ) as c
      from gov_convenios cv
    ) sub
  )
));
""", encoding='utf-8')

print(f'OK -> {OUT}')
print('  1) Abre Supabase SQL Editor')
print('  2) Cola e roda o conteudo de export_seed.sql')
print('  3) Copia o JSON do resultado, cola em /gov_seed.json')
print('  4) git add gov_seed.json && git commit && git push')
