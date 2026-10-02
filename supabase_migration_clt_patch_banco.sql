-- ══════════════════════════════════════════════════════════════════
-- clt_patch_banco — gravação ATÔMICA do resultado de UM banco na fila CLT.
--
-- Problema: api/clt-fila.js (patchBanco) lia o jsonb `bancos` inteiro, mexia
-- num banco e gravava tudo de volta. Com ~17 bancos rodando em paralelo, a
-- gravação de um apagava a do outro (lost update) → card ficava 'pending'/
-- 'processando' pra sempre mesmo com o banco tendo respondido.
--
-- Esta função faz o merge DENTRO do Postgres (uma única UPDATE atômica):
--   bancos = bancos || { banco: (bancos->banco) || payload }
-- O código chama via RPC e, se a função não existir, cai no fallback
-- (read-modify-write com verificação) — ou seja, rodar este SQL é o que
-- elimina a corrida de vez.
--
-- Como aplicar: Supabase → SQL Editor → colar e executar (1x).
-- ══════════════════════════════════════════════════════════════════

create or replace function public.clt_patch_banco(p_id text, p_banco text, p_payload jsonb)
returns setof public.clt_consultas_fila
language sql
security definer
set search_path = public
as $$
  update public.clt_consultas_fila
     set bancos = coalesce(bancos, '{}'::jsonb)
                  || jsonb_build_object(
                       p_banco,
                       coalesce(bancos -> p_banco, '{}'::jsonb) || coalesce(p_payload, '{}'::jsonb)
                     )
   where id::text = p_id
  returning *;
$$;

comment on function public.clt_patch_banco(text, text, jsonb)
  is 'FlowForce CLT: merge atômico do resultado de um banco em clt_consultas_fila.bancos (evita lost update entre bancos em paralelo)';

grant execute on function public.clt_patch_banco(text, text, jsonb) to service_role;
grant execute on function public.clt_patch_banco(text, text, jsonb) to authenticated;

-- Conferência rápida (deve retornar 1 linha com a função):
-- select proname, pg_get_function_arguments(oid) from pg_proc where proname = 'clt_patch_banco';
