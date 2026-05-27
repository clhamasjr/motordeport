'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BancoState, BancoSlug, ClienteData } from '@/lib/clt-types';
import { formatBRL, formatCnpj, cn } from '@/lib/utils';
import { Loader2, Wrench, CheckCircle2, Camera, FileText, RefreshCw, Smartphone } from 'lucide-react';
import { useGerarLinkSelfieC6, useRecarregarC6 } from '@/hooks/use-clt-c6';
import { useMercantilSolicitarSMS, useMercantilVerificarAutorizacao } from '@/hooks/use-clt-mercantil';
import { useReprocessarBanco } from '@/hooks/use-clt-fila';

const BANCO_LABEL: Record<BancoSlug, string> = {
  presencabank: 'PresençaBank',
  multicorban: 'Multicorban',
  v8_qi: 'V8 (QI Tech)',
  v8_celcoin: 'V8 (Celcoin)',
  joinbank: 'QualiBanking',
  mercantil: 'Mercantil',
  handbank: 'Handbank · UY3',
  c6: 'C6 Bank',
  fintech_qi: 'Fintech (QI Tech)',
  fintech_celcoin: 'Fintech (Celcoin)',
  unno: 'Unno (ITAPEMA/QITech)',
  nossa_fintech: 'A NOSSA FINTECH',
};

const BANCO_COR: Record<BancoSlug, string> = {
  presencabank: 'border-l-bank-pb',
  multicorban: 'border-l-muted',
  v8_qi: 'border-l-bank-v8',
  v8_celcoin: 'border-l-bank-v8',
  joinbank: 'border-l-bank-joinbank',
  mercantil: 'border-l-bank-mercantil',
  handbank: 'border-l-bank-handbank',
  c6: 'border-l-bank-c6',
  fintech_qi: 'border-l-bank-fintech_qi',
  fintech_celcoin: 'border-l-bank-fintech_celcoin',
  unno: 'border-l-purple-500', // cor temp — sem token customizado ainda
  nossa_fintech: 'border-l-orange-500', // cor temp pra A NOSSA FINTECH
};

interface Props {
  banco: BancoSlug;
  state: BancoState;
  onSimularDigitar?: () => void;
  // Dados do cliente — necessarios pra gerar selfie C6 (so o card C6 usa)
  cliente?: ClienteData;
  filaId?: string;
}

function StatusPill({ state }: { state: BancoState }) {
  if (state.emManutencao || state.status === 'em_manutencao') {
    return (
      <Badge variant="warning" className="gap-1">
        <Wrench className="w-3 h-3" />
        Manutenção
      </Badge>
    );
  }
  if (state.status === 'processando' || state.status === 'pending') {
    return (
      <Badge variant="info" className="gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Processando
      </Badge>
    );
  }
  if (state.status === 'ok' && state.disponivel) {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="w-3 h-3" />
        Disponível
      </Badge>
    );
  }
  // "Já contratado" tem prioridade sobre "Aguarda autorização": Handbank/UY3
  // marca status='bloqueado' quando cliente ja tem contrato ativo, mas isso
  // NAO eh falta de autorizacao — eh impedimento permanente.
  if (state.jaTemContrato) {
    return <Badge variant="muted">Já contratado</Badge>;
  }
  // C6 usa `requiresLiveness`; Mercantil/Celcoin usam `precisaAutorizacao`;
  // genericamente, qualquer 'bloqueado' que nao seja "ja contratado" cai aqui
  // (fallback preserva comportamento antigo pra bancos que so setam status).
  if (
    state.precisaAutorizacao ||
    state.requiresLiveness ||
    state.status === 'bloqueado'
  ) {
    return <Badge variant="warning">Aguarda autorização</Badge>;
  }
  return <Badge variant="muted">Indisponível</Badge>;
}

export function BancoOfertaCard({ banco, state, onSimularDigitar, cliente, filaId }: Props) {
  const label = BANCO_LABEL[banco] || banco;
  const cor = BANCO_COR[banco] || 'border-l-muted';
  const isManutencao = state.emManutencao || state.status === 'em_manutencao';
  const margem = state.dados?.margemDisponivel || 0;
  const empregador = state.dados?.empregador;
  const cnpj = state.dados?.empregadorCnpj;
  const valorLiquido = state.dados?.valorLiquido || 0;
  const parcelas = state.dados?.parcelas;
  const valorParcela = state.dados?.valorParcela;
  const disponivel = state.status === 'ok' && state.disponivel;

  // ─── C6: tratamento especial — bloqueado ate cliente fazer selfie ──
  const gerarSelfie = useGerarLinkSelfieC6();
  const recarregarC6 = useRecarregarC6();
  const isC6Bloqueado =
    banco === 'c6' &&
    !isManutencao &&
    (state.bloqueado === true ||
      state.status === 'bloqueado' ||
      state.requiresLiveness === true);
  const isAguardandoSelfie =
    isC6Bloqueado && state.statusAutorizacao === 'AGUARDANDO_AUTORIZACAO';

  const dispararLiberarC6 = () => {
    if (!cliente) return;
    let tel = cliente.telefones?.[0]?.completo || '';
    if (!cliente.nome || !cliente.dataNascimento) {
      alert('Pra gerar a selfie do C6 preciso de NOME e DATA DE NASCIMENTO. Refaca a consulta preenchendo o nome.');
      return;
    }
    if (!tel) {
      const inp = prompt('📱 Telefone do cliente nao foi encontrado nas bases.\n\nDigita o celular pra mandar o link de autorizacao C6 (com DDD, ex: 15998583505):');
      if (inp === null) return;
      const digits = String(inp).replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 11) {
        alert('Telefone invalido. Use formato: DDD + 9 digitos.');
        return;
      }
      tel = digits;
    }
    gerarSelfie.mutate({
      cpf: cliente.cpf || '',
      nome: cliente.nome,
      dataNascimento: cliente.dataNascimento,
      telefone: tel,
      filaId,
    });
  };

  // ─── Mercantil: tratamento especial — bloqueado ate cliente autorizar SMS ──
  const mercantilSolicitarSMS = useMercantilSolicitarSMS();
  const mercantilVerificar = useMercantilVerificarAutorizacao();
  const isMercantilBloqueado =
    banco === 'mercantil' &&
    !isManutencao &&
    (state.bloqueado === true || state.status === 'bloqueado') &&
    state.precisaAutorizacao === true;

  const dispararSmsMercantil = () => {
    if (!state.operacaoId) {
      alert('Sem operacaoId — refaça a consulta CLT pra Mercantil retornar o ID.');
      return;
    }
    let tel = cliente?.telefones?.[0]?.completo || '';
    if (!tel) {
      const inp = prompt('📱 Telefone do cliente não encontrado nas bases.\n\nDigite o celular pra disparar o SMS de autorização Mercantil (com DDD, ex: 15998583505):');
      if (inp === null) return;
      const digits = String(inp).replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 11) {
        alert('Telefone inválido. Use DDD + 9 dígitos.');
        return;
      }
      tel = digits;
    }
    const semCountry = tel.startsWith('55') && tel.length >= 12 ? tel.substring(2) : tel;
    const ddd = semCountry.substring(0, 2);
    const num = semCountry.substring(2);
    const nomeCli = state.nomeCliente || cliente?.nome || 'o cliente';
    if (!confirm(`Mercantil vai enviar SMS pra (${ddd}) ${num} com link de autorização DataPrev.\n\nCliente: ${nomeCli}\n\nConfirma?`)) return;
    mercantilSolicitarSMS.mutate({
      filaId,
      operacaoId: state.operacaoId,
      telefone: tel,
      nomeCliente: nomeCli,
    });
  };

  const verificarMercantil = () => {
    if (!cliente?.cpf) {
      alert('Sem CPF do cliente — refaça a consulta.');
      return;
    }
    mercantilVerificar.mutate({ cpf: cliente.cpf, filaId });
  };

  // ─── Re-tentar: re-dispara processamento desse banco com force=true ──
  // Aparece em qualquer card em status='falha' (operador decide quando
  // re-tentar — ex: banco travado por 10min, ou erro transitorio).
  const reprocessar = useReprocessarBanco();
  const podeRetentar = state.status === 'falha' && !!filaId;
  const dispararRetentar = () => {
    if (!filaId) return;
    reprocessar.mutate({ filaId, banco });
  };

  return (
    <Card
      className={cn(
        'border-l-4 p-3 space-y-2',
        cor,
        isManutencao && 'opacity-65',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-sm flex items-center gap-1.5">
          🏦 {label}
        </div>
        <StatusPill state={state} />
      </div>

      {/* C6 BLOQUEADO — botoes de gerar selfie + reconsultar */}
      {isC6Bloqueado && (
        <div className="space-y-2">
          <div className="text-xs text-yellow-400">
            {state.mensagem || '📸 Cliente precisa autorizar a consulta C6 via selfie DataPrev.'}
          </div>
          {isAguardandoSelfie && (
            <Badge variant="warning" className="gap-1 text-[10px]">
              <Camera className="w-3 h-3" /> Aguardando cliente fazer a selfie
            </Badge>
          )}
          <Button
            size="sm"
            className="w-full gap-1"
            onClick={dispararLiberarC6}
            disabled={gerarSelfie.isPending}
          >
            <Camera className="w-3 h-3" />
            {gerarSelfie.isPending ? 'Gerando...' : '📸 Gerar Selfie + Enviar WhatsApp'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1 text-xs"
            disabled={recarregarC6.isPending || !cliente?.cpf}
            onClick={() => cliente?.cpf && recarregarC6.mutate({ cpf: cliente.cpf, filaId })}
          >
            <RefreshCw className={cn('w-3 h-3', recarregarC6.isPending && 'animate-spin')} />
            Já autorizou? Reconsultar C6
          </Button>
        </div>
      )}

      {/* MERCANTIL BLOQUEADO — botões SMS + verificar autorização */}
      {isMercantilBloqueado && (
        <div className="space-y-2">
          <div className="text-xs text-yellow-400 flex items-start gap-1">
            <Smartphone className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>📲 Aguardando autorização do cliente</span>
          </div>
          <div className="text-[11px] text-muted-foreground/80">
            {state.nomeCliente || cliente?.nome || 'Cliente'} já está cadastrado no Mercantil — precisa autorizar consulta DataPrev via SMS.
          </div>
          <Button
            size="sm"
            className="w-full gap-1"
            onClick={dispararSmsMercantil}
            disabled={mercantilSolicitarSMS.isPending || !state.operacaoId}
            title={!state.operacaoId ? 'Refaça a consulta — sem operacaoId' : 'Mercantil envia SMS oficial com link bml.b.br'}
          >
            <Smartphone className="w-3 h-3" />
            {mercantilSolicitarSMS.isPending ? 'Enviando SMS...' : '📲 Solicitar SMS pro Cliente'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1 text-xs"
            onClick={verificarMercantil}
            disabled={mercantilVerificar.isPending || !cliente?.cpf}
          >
            <RefreshCw className={cn('w-3 h-3', mercantilVerificar.isPending && 'animate-spin')} />
            Já autorizou? Verificar
          </Button>
          {!state.operacaoId && (
            <div className="text-[10px] text-destructive/80">
              ⚠ Sem operacaoId — refaça a consulta pra recuperar
            </div>
          )}
        </div>
      )}

      {/* Mensagem principal */}
      {isC6Bloqueado || isMercantilBloqueado ? null : isManutencao ? (
        <div className="text-xs text-muted-foreground">{state.mensagem || '🔧 Em manutenção'}</div>
      ) : disponivel ? (
        <div className="space-y-1.5">
          {/* Valor liberado quando tem simulação detalhada */}
          {valorLiquido > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Valor</div>
                <div className="text-xl font-black text-green-400">{formatBRL(valorLiquido)}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Parcelas</div>
                <div className="text-base font-bold">
                  {parcelas || '?'}x {valorParcela ? formatBRL(valorParcela) : ''}
                </div>
              </div>
            </div>
          )}

          {/* Margem real (sempre que tem) */}
          {margem > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">Margem real:</span>{' '}
              <b>{formatBRL(margem)}</b>
            </div>
          )}

          {/* Empregador + CNPJ */}
          {empregador && (
            <div className="text-xs text-muted-foreground">
              <b>Empregador:</b> {empregador.substring(0, 40)}
            </div>
          )}
          {cnpj && (
            <div className="text-xs text-muted-foreground">
              CNPJ: {formatCnpj(cnpj)}
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">{state.mensagem || 'Aguardando bancos...'}</div>
      )}

      {/* Selo extras */}
      <div className="flex flex-wrap gap-1">
        {state.statusAutorizacao === 'AGUARDANDO_AUTORIZACAO' && (
          <Badge variant="warning" className="gap-1 text-[10px]">
            <Camera className="w-3 h-3" />
            Aguarda selfie
          </Badge>
        )}
        {state.precisaAutorizacao && state.linkAutorizacao && (
          <Badge variant="info" className="gap-1 text-[10px]">
            <FileText className="w-3 h-3" />
            Link autorização
          </Badge>
        )}
      </div>

      {/* Botão Simular & Digitar */}
      {disponivel && onSimularDigitar && (
        <Button onClick={onSimularDigitar} size="sm" className="w-full mt-2">
          {valorLiquido > 0 ? '📝 Digitar Proposta' : '📝 Simular & Digitar'}
        </Button>
      )}

      {/* Re-tentar — aparece em QUALQUER banco em falha (operador decide).
          Re-dispara o handler 'processar' com force=true, que bypassa
          idempotencia e roda novamente. Disabled durante o request. */}
      {podeRetentar && (
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-2 gap-1"
          onClick={dispararRetentar}
          disabled={reprocessar.isPending}
        >
          <RefreshCw className={cn('w-3 h-3', reprocessar.isPending && 'animate-spin')} />
          {reprocessar.isPending ? 'Re-tentando...' : 'Re-tentar este banco'}
        </Button>
      )}
    </Card>
  );
}
