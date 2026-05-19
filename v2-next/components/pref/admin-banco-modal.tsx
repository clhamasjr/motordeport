'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePrefBancos, useUpsertBancoConvenio, useCriarPrefBanco } from '@/hooks/use-pref-catalogo';
import type { PrefConvenio, BancoConvenioPref, RegimeAtendido } from '@/lib/pref-types';
import { regimeLabel } from '@/lib/pref-types';

interface Props {
  convenio: PrefConvenio;
  vinculo: BancoConvenioPref | null;
  onClose: () => void;
}

export function AdminBancoModal({ convenio, vinculo, onClose }: Props) {
  const { data: bancosData } = usePrefBancos();
  const upsertMut = useUpsertBancoConvenio(convenio.slug);
  const criarBancoMut = useCriarPrefBanco();

  // Estado do form
  const [bancoId, setBancoId] = useState<string>(vinculo ? String(vinculo.banco_id) : '');
  const [novoBancoNome, setNovoBancoNome] = useState('');
  const [suspenso, setSuspenso] = useState(!!vinculo?.suspenso);
  const [opNovo, setOpNovo] = useState(!!vinculo?.operacoes.novo);
  const [opRefin, setOpRefin] = useState(!!vinculo?.operacoes.refin);
  const [opPort, setOpPort] = useState(!!vinculo?.operacoes.port);
  const [opCartao, setOpCartao] = useState(!!vinculo?.operacoes.cartao);
  const [regime, setRegime] = useState<RegimeAtendido>(vinculo?.regime_atendido || 'RPPS');
  const [pubAtivo, setPubAtivo] = useState(vinculo?.publico_ativo !== false);
  const [pubApos, setPubApos] = useState(vinculo?.publico_aposentado !== false);
  const [pubPens, setPubPens] = useState(vinculo?.publico_pensionista !== false);
  const [margem, setMargem] = useState(
    vinculo?.margem_utilizavel != null ? (vinculo.margem_utilizavel * 100).toFixed(2).replace('.', ',') : ''
  );
  const [taxaPort, setTaxaPort] = useState(
    vinculo?.taxa_minima_port != null ? (vinculo.taxa_minima_port * 100).toFixed(2).replace('.', ',') : ''
  );
  const [idadeMin, setIdadeMin] = useState(vinculo?.idade_min?.toString() || '');
  const [idadeMax, setIdadeMax] = useState(vinculo?.idade_max?.toString() || '');
  const [prazoMax, setPrazoMax] = useState(vinculo?.prazo_max_meses?.toString() || '');
  const [valorMin, setValorMin] = useState(vinculo?.valor_minimo_op?.toString() || '');
  const [valorMax, setValorMax] = useState(vinculo?.valor_maximo_op?.toString() || '');
  const [dataCorte, setDataCorte] = useState(vinculo?.data_corte || '');
  const [obs, setObs] = useState(vinculo?.observacoes_admin || '');
  const [salvando, setSalvando] = useState(false);

  async function handleSalvar() {
    setSalvando(true);
    try {
      let bId = bancoId ? parseInt(bancoId, 10) : 0;
      if (!bId && novoBancoNome.trim()) {
        const novo = await criarBancoMut.mutateAsync({ nome: novoBancoNome.trim() });
        bId = novo.id;
      }
      if (!bId) {
        alert('Selecione um banco existente OU informe nome de banco novo');
        setSalvando(false);
        return;
      }
      await upsertMut.mutateAsync({
        id: vinculo?.id,
        banco_id: bId,
        convenio_id: convenio.id,
        suspenso,
        opera_novo: opNovo,
        opera_refin: opRefin,
        opera_port: opPort,
        opera_cartao: opCartao,
        regime_atendido: regime,
        publico_ativo: pubAtivo,
        publico_aposentado: pubApos,
        publico_pensionista: pubPens,
        margem_utilizavel: margem || null,
        taxa_minima_port: taxaPort || null,
        idade_min: idadeMin ? parseInt(idadeMin, 10) : null,
        idade_max: idadeMax ? parseInt(idadeMax, 10) : null,
        prazo_max_meses: prazoMax ? parseInt(prazoMax, 10) : null,
        valor_minimo_op: valorMin ? parseFloat(valorMin) : null,
        valor_maximo_op: valorMax ? parseFloat(valorMax) : null,
        data_corte: dataCorte || null,
        observacoes_admin: obs || null,
      });
      onClose();
    } catch {
      // toast já é mostrado pelo hook
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {vinculo ? '✏️ Editar banco no convênio' : '+ Adicionar banco ao convênio'}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">Convênio: {convenio.nome}</p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Banco */}
          <div>
            <Label>Banco</Label>
            {vinculo ? (
              <div className="mt-1 p-2 bg-secondary rounded font-semibold text-sm">
                {vinculo.banco_nome}
              </div>
            ) : (
              <>
                <select
                  className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                  value={bancoId}
                  onChange={(e) => setBancoId(e.target.value)}
                >
                  <option value="">— Selecione ou crie novo abaixo —</option>
                  {bancosData?.bancos.map((b) => (
                    <option key={b.id} value={b.id}>{b.nome}</option>
                  ))}
                </select>
                <Input
                  className="mt-2"
                  placeholder="OU digite nome de banco novo (ex: BMG CLT)"
                  value={novoBancoNome}
                  onChange={(e) => setNovoBancoNome(e.target.value)}
                />
              </>
            )}
          </div>

          {/* Operações */}
          <div>
            <Label className="text-xs uppercase tracking-wider">📋 Operações</Label>
            <div className="flex gap-4 flex-wrap mt-2 text-sm">
              <Chk label="Novo" v={opNovo} on={setOpNovo} />
              <Chk label="Refin" v={opRefin} on={setOpRefin} />
              <Chk label="Portabilidade" v={opPort} on={setOpPort} />
              <Chk label="Cartão Benefício" v={opCartao} on={setOpCartao} />
            </div>
          </div>

          {/* Regime */}
          <div>
            <Label className="text-xs uppercase tracking-wider">🏛️ Regime Previdenciário Atendido</Label>
            <div className="flex gap-3 flex-col mt-2 text-sm">
              {(['RPPS', 'RGPS', 'AMBOS'] as RegimeAtendido[]).map((r) => (
                <label key={r} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={regime === r} onChange={() => setRegime(r)} />
                  <span>{regimeLabel(r)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Público */}
          <div>
            <Label className="text-xs uppercase tracking-wider">👥 Público-Alvo</Label>
            <div className="flex gap-4 flex-wrap mt-2 text-sm">
              <Chk label="Ativo" v={pubAtivo} on={setPubAtivo} />
              <Chk label="Aposentado" v={pubApos} on={setPubApos} />
              <Chk label="Pensionista" v={pubPens} on={setPubPens} />
            </div>
          </div>

          {/* Suspenso */}
          <div className="bg-destructive/5 p-2 rounded">
            <Chk label="⛔ Banco suspenso neste convênio" v={suspenso} on={setSuspenso} />
          </div>

          {/* Numéricos em grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Margem (%)" v={margem} on={setMargem} ph="35 ou 0,35" />
            <Field label="Taxa Port (%/mês)" v={taxaPort} on={setTaxaPort} ph="1,85" />
            <Field label="Idade min" v={idadeMin} on={setIdadeMin} ph="21" type="number" />
            <Field label="Idade max" v={idadeMax} on={setIdadeMax} ph="79" type="number" />
            <Field label="Prazo máx (meses)" v={prazoMax} on={setPrazoMax} ph="96" type="number" />
            <Field label="Valor min (R$)" v={valorMin} on={setValorMin} ph="500" type="number" />
            <Field label="Valor max (R$)" v={valorMax} on={setValorMax} ph="50000" type="number" />
            <Field label="Data de corte" v={dataCorte} on={setDataCorte} ph="Dia 15" />
          </div>

          {/* Observações */}
          <div>
            <Label htmlFor="obs">Observações (regras especiais, exigências)</Label>
            <textarea
              id="obs"
              rows={3}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Ex: Exige tempo mínimo de 6 meses no cargo. Não aceita servidor com restrição."
              className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm resize-y"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={salvando}>
            {salvando ? '⏳ Salvando…' : '💾 Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Chk({ label, v, on }: { label: string; v: boolean; on: (b: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Field({ label, v, on, ph, type = 'text' }: { label: string; v: string; on: (s: string) => void; ph?: string; type?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      <Input value={v} onChange={(e) => on(e.target.value)} placeholder={ph} type={type} className="text-sm" />
    </div>
  );
}
