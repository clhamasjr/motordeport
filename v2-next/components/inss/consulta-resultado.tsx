'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCpf, formatBRL } from '@/lib/utils';
import { ConsultaInssView } from '@/lib/inss-types';
import {
  X, Wallet, MapPin, CreditCard, Phone, FileText, RefreshCw,
} from 'lucide-react';
import { OportunidadesIdentificadas } from './oportunidades-identificadas';
import { SaqueComplementar } from './saque-complementar';
import { CalculadoraManual } from './calculadora-manual';
import { parseBR } from '@/lib/inss-motor';

interface Props {
  cpf: string;
  view: ConsultaInssView;
  onClose: () => void;
  onReConsult?: () => void;
}

export function ConsultaResultado({ cpf, view, onClose, onReConsult }: Props) {
  const { parsed } = view;
  const b = parsed.beneficiario || {};
  const ben = parsed.beneficio || {};
  const mrg = parsed.margem || {};
  const endereco = parsed.endereco || {};
  const bancoPag = parsed.banco || {};

  return (
    <Card className="border-border">
      <CardContent className="p-5 space-y-4">
        {/* Header rico */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold truncate">{b.nome || '(sem nome)'}</h2>
              {ben.situacao && (
                <Badge variant={ben.situacao.toUpperCase() === 'ATIVO' ? 'success' : 'muted'} className="text-[10px]">
                  {ben.situacao}
                </Badge>
              )}
              {ben.desbloqueio && (
                <Badge variant="info" className="text-[10px]">{ben.desbloqueio}</Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
              <span className="font-mono">CPF {formatCpf(cpf)}</span>
              {b.nb && <span className="font-mono">NB {b.nb}</span>}
              {ben.especie && <span>{ben.especie}</span>}
              {b.idade && <span>{b.idade} anos</span>}
              {b.nome_mae && <span className="text-muted-foreground/60">mãe: {b.nome_mae}</span>}
              {b.rg && <span className="font-mono text-muted-foreground/60">RG {b.rg}</span>}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <CalculadoraManual parsed={parsed} />
            {onReConsult && (
              <Button variant="outline" size="sm" onClick={onReConsult} title="Recarregar">
                <RefreshCw className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar">
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* KPIs principais */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Kpi label="Valor benefício" value={formatBRL(parseBR(ben.valor))} cor="text-cyan-400" />
          <Kpi label="Base cálculo" value={formatBRL(parseBR(ben.base_calculo))} cor="text-cyan-400" />
          <Kpi label="Parcelas emp." value={formatBRL(parseBR(mrg.parcelas))} cor="text-red-400" />
          <Kpi label="Margem livre" value={formatBRL(parseBR(mrg.disponivel))} cor="text-green-400" />
          <Kpi label="RMC livre" value={formatBRL(parseBR(mrg.rmc))} cor="text-purple-400" />
          <Kpi label="RCC livre" value={formatBRL(parseBR(mrg.rcc))} cor="text-pink-400" />
        </div>

        {/* ✨ Análise NOVA regra INSS (40%) — único card de enquadramento */}
        <OportunidadesIdentificadas parsed={parsed} />

        {/* 💳 Saque Complementar */}
        <SaqueComplementar cpf={cpf} matricula={b.nb || ben.nb} />

        {/* Grid de info adicional: Benefício, Conta, Endereço */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Card Benefício */}
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider font-bold mb-2 flex items-center gap-1">
                <FileText className="size-3 text-orange-400" />
                <span className="text-orange-400">Benefício</span>
              </div>
              <div className="space-y-1.5 text-xs">
                {ben.especie && (
                  <Linha label="Espécie" value={ben.especie} />
                )}
                {b.data_nascimento && (
                  <Linha label="Nascimento" value={b.data_nascimento} mono />
                )}
                {ben.ddb && (
                  <Linha label="DDB" value={ben.ddb} mono />
                )}
                {ben.data_extrato && (
                  <Linha label="Data extrato" value={ben.data_extrato} mono />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Card Conta Pagadora */}
          {(bancoPag.nome || bancoPag.agencia || bancoPag.conta) && (
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider font-bold mb-2 flex items-center gap-1">
                  <Wallet className="size-3 text-blue-400" />
                  <span className="text-blue-400">Conta Pagadora</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  {bancoPag.nome && <Linha label="Banco" value={bancoPag.nome} />}
                  {bancoPag.agencia && <Linha label="Agência" value={bancoPag.agencia} mono />}
                  {bancoPag.conta && <Linha label="Conta" value={bancoPag.conta} mono />}
                  {bancoPag.tipo && <Linha label="Tipo" value={bancoPag.tipo} />}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Endereço */}
        {(endereco.endereco || endereco.cep) && (
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider font-bold mb-2 flex items-center gap-1">
                <MapPin className="size-3 text-yellow-400" />
                <span className="text-yellow-400">Endereço</span>
              </div>
              <div className="text-xs">
                {endereco.endereco}
                {endereco.bairro && ` — ${endereco.bairro}`}
                {endereco.municipio && ` · ${endereco.municipio}`}
                {endereco.uf && `/${endereco.uf}`}
                {endereco.cep && <span className="font-mono ml-1">— CEP: {endereco.cep}</span>}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Telefones */}
        {parsed.telefones && parsed.telefones.length > 0 && (
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider font-bold mb-2 flex items-center gap-1">
                <Phone className="size-3 text-green-400" />
                <span className="text-green-400">Telefones ({parsed.telefones.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5 font-mono text-xs">
                {parsed.telefones.map((t, i) => (
                  <Badge key={i} variant="outline" className="py-1 px-2">
                    ({t.ddd}) {t.numero}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cartões detalhados */}
        {parsed.cartoes && parsed.cartoes.length > 0 && (
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider font-bold mb-2 flex items-center gap-1">
                <CreditCard className="size-3 text-pink-400" />
                <span className="text-pink-400">Cartões ({parsed.cartoes.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {parsed.cartoes.map((c, i) => {
                  const tipo = (c.tipo || '').toUpperCase();
                  const isRmc = tipo.includes('RMC');
                  const cor = isRmc ? 'border-purple-500/40 bg-purple-500/5' : 'border-pink-500/40 bg-pink-500/5';
                  const corTxt = isRmc ? 'text-purple-400' : 'text-pink-400';
                  return (
                    <div key={i} className={`rounded-md border p-2 ${cor}`}>
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant="outline" className={`text-[10px] ${corTxt}`}>
                          {tipo || 'Cartão'}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{c.banco || c.banco_codigo}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-[9px] text-muted-foreground uppercase font-semibold">Margem</div>
                          <div className="font-mono font-semibold">{formatBRL(parseBR(c.margem))}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-muted-foreground uppercase font-semibold">Limite</div>
                          <div className="font-mono font-semibold">{formatBRL(parseBR(c.limite))}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, cor }: { label: string; value: string; cor: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-base font-mono font-bold mt-0.5 ${cor}`}>{value}</div>
    </div>
  );
}

function Linha({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className={`text-right truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
