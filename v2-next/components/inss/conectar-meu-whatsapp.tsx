'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';
import {
  useCreateInstance, useConnectInstance, useInstanceStatus, useSaveMyWhatsapp,
} from '@/hooks/use-inss-evolution';
import { Smartphone, QrCode, CheckCircle2, RefreshCw, Loader2, Link2 } from 'lucide-react';
import { toast } from 'sonner';

// Normaliza nome de instância: minúsculas, só letras/números/hífen
function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function normalizaQr(qr?: string | null): string | null {
  if (!qr) return null;
  return qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`;
}

/**
 * "Conectar meu WhatsApp" — qualquer usuário cria/pareia a PRÓPRIA instância
 * Evolution (QR code) e ela fica salva no perfil (bank_codes.WPP). É o que
 * liga o isolamento de conversas: cada vendedor só vê as conversas da sua linha.
 */
export function ConectarMeuWhatsApp() {
  const { user } = useAuth();
  const instanciaSalva = user?.bank_codes?.WPP || '';

  // nome sugerido estável e único por usuário
  const sugerido = useMemo(
    () => instanciaSalva || (user?.username ? `lhamas-${slug(user.username)}` : ''),
    [instanciaSalva, user?.username],
  );
  const [nome, setNome] = useState(sugerido);
  useEffect(() => { setNome(sugerido); }, [sugerido]);

  const [qr, setQr] = useState<string | null>(null);
  const [pareando, setPareando] = useState(false);
  const [instanciaAtiva, setInstanciaAtiva] = useState<string | null>(instanciaSalva || null);

  const criar = useCreateInstance();
  const conectar = useConnectInstance();
  const salvar = useSaveMyWhatsapp();
  const { data: estado } = useInstanceStatus(instanciaAtiva, pareando || !!instanciaSalva);

  const conectado = estado === 'open';

  // Quando detecta conexão durante o pareamento, salva no perfil e encerra
  useEffect(() => {
    if (pareando && conectado && instanciaAtiva) {
      setPareando(false);
      setQr(null);
      salvar.mutate(instanciaAtiva, {
        onSuccess: () => toast.success('WhatsApp conectado e vinculado ao seu usuário! 🎉'),
      });
    }
  }, [pareando, conectado, instanciaAtiva]); // eslint-disable-line react-hooks/exhaustive-deps

  async function gerarQr() {
    const inst = slug(nome);
    if (!inst) { toast.error('Defina um nome pra sua conexão'); return; }
    setInstanciaAtiva(inst);
    // Se já é a instância salva, tenta reconectar; senão cria nova.
    const jaExiste = inst === slug(instanciaSalva);
    const r = jaExiste
      ? await conectar.mutateAsync(inst)
      : await criar.mutateAsync(inst).catch(async () => conectar.mutateAsync(inst));
    const img = normalizaQr(r?.qrcode);
    if (img) {
      setQr(img);
      setPareando(true);
    } else if ((r?.state || (r as { instance?: { state?: string } })?.instance?.state) === 'open') {
      // já estava conectado
      setPareando(false);
      salvar.mutate(inst, { onSuccess: () => toast.success('WhatsApp já conectado — vinculado ao seu usuário!') });
    } else {
      toast.error('Não recebi o QR Code. Tente "Atualizar QR".');
    }
  }

  const carregando = criar.isPending || conectar.isPending;

  return (
    <Card className="border-green-500/30">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Smartphone className="size-5 text-green-400" />
          <h2 className="font-bold text-sm">Conectar meu WhatsApp</h2>
          {conectado ? (
            <Badge variant="success" className="text-[10px]">conectado</Badge>
          ) : instanciaSalva ? (
            <Badge variant="warning" className="text-[10px]">desconectado</Badge>
          ) : (
            <Badge variant="muted" className="text-[10px]">não configurado</Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Conecte o seu número de WhatsApp pra atender seus clientes pela plataforma.
          Você só enxerga as conversas da <strong>sua</strong> linha.
        </p>

        {/* Status atual */}
        {instanciaSalva && (
          <div className="flex items-center gap-2 text-xs rounded-md border border-border bg-card/50 p-2">
            <Link2 className="size-3.5 text-muted-foreground" />
            Sua conexão: <span className="font-mono font-semibold">{instanciaSalva}</span>
            {conectado && <CheckCircle2 className="size-3.5 text-green-400" />}
          </div>
        )}

        {/* Nome da conexão (editável só na 1ª vez) */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Nome da sua conexão
            </Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              disabled={!!instanciaSalva || pareando}
              placeholder="lhamas-seunome"
              className="font-mono mt-1"
            />
          </div>
          <Button onClick={gerarQr} disabled={carregando || !nome} className="bg-green-600 hover:bg-green-700">
            {carregando ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
            {qr ? 'Atualizar QR' : instanciaSalva ? 'Reconectar' : 'Gerar QR Code'}
          </Button>
        </div>

        {/* QR Code + instruções */}
        {qr && !conectado && (
          <div className="flex flex-col sm:flex-row gap-4 items-center rounded-lg border border-green-500/30 bg-green-500/5 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR Code WhatsApp" className="size-52 rounded-md bg-white p-2 shrink-0" />
            <div className="text-xs space-y-2">
              <div className="font-semibold text-green-300 flex items-center gap-1">
                {pareando && <Loader2 className="size-3.5 animate-spin" />}
                Escaneie pra conectar:
              </div>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Abra o <strong>WhatsApp</strong> no seu celular</li>
                <li>Toque em <strong>⋮ → Aparelhos conectados</strong></li>
                <li>Toque em <strong>Conectar um aparelho</strong></li>
                <li>Aponte a câmera pra este QR Code</li>
              </ol>
              <div className="text-[10px] text-muted-foreground/70">
                O QR expira em ~40s. Se não funcionar, clique em "Atualizar QR".
              </div>
            </div>
          </div>
        )}

        {conectado && (
          <div className="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/40 p-3 text-sm text-green-300">
            <CheckCircle2 className="size-5" />
            WhatsApp conectado! Suas conversas já aparecem em <strong>INSS → Conversas</strong>.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
