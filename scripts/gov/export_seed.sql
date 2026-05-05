-- Roda no Supabase SQL Editor pra exportar o estado atual como JSON.
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
