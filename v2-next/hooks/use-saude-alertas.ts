// ════════════════════════════════════════════════════════════════════
// hooks/use-saude-alertas.ts
//
// Alerta em tempo real no painel /orquestrador. Observa o resultado do
// useOrquestradorSaude e, quando um banco/agente TRANSICIONA pra erro
// (ok → erro), dispara:
//   - beep sonoro (Web Audio, sem arquivo de áudio)
//   - notificação do navegador (aparece no canto do SO mesmo com aba atrás)
//
// Só alerta na MUDANÇA, não a cada refresh — evita barulho repetido.
// O áudio precisa de um gesto do usuário pra "destravar" (regra do browser),
// por isso expõe `armar()` que deve ser chamado num clique de botão.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SaudeSaaS } from '@/lib/orquestrador-types';

type Permissao = 'default' | 'granted' | 'denied' | 'indisponivel';

function tocarBeep(ctx: AudioContext) {
  try {
    // 3 bipes curtos, descendentes — chamativo sem ser um alarme de incêndio
    const freqs = [880, 740, 880];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = 'square';
      const t = ctx.currentTime + i * 0.18;
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.start(t);
      o.stop(t + 0.16);
    });
  } catch {
    /* áudio não disponível — silencioso */
  }
}

export function useSaudeAlertas(data: SaudeSaaS | undefined) {
  const [armado, setArmado] = useState(false);
  const [permissao, setPermissao] = useState<Permissao>('default');
  const ctxRef = useRef<AudioContext | null>(null);
  // mapa key → último status conhecido, pra detectar transição
  const prevRef = useRef<Record<string, string>>({});

  // Sincroniza permissão atual de notificação
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermissao('indisponivel');
      return;
    }
    setPermissao(Notification.permission as Permissao);
  }, []);

  // "Arma" os alertas: destrava o áudio (gesto do usuário) e pede permissão
  // de notificação. Deve ser chamado de um onClick.
  const armar = useCallback(async () => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC && !ctxRef.current) ctxRef.current = new AC();
      if (ctxRef.current?.state === 'suspended') await ctxRef.current.resume();
    } catch {
      /* sem áudio */
    }
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        const p = await Notification.requestPermission();
        setPermissao(p as Permissao);
      } catch {
        /* ignore */
      }
    }
    setArmado(true);
  }, []);

  // Observa mudanças de status e dispara alerta nas transições pra erro
  useEffect(() => {
    if (!data) return;

    const itens: { key: string; label: string; status: string; detalhe?: string }[] = [
      ...data.bancos.map((b) => ({ key: `banco:${b.key}`, label: b.label, status: b.status, detalhe: b.erroMsg })),
      ...data.agentes.map((a) => ({ key: `agente:${a.key}`, label: a.label, status: a.status, detalhe: a.erroMsg })),
    ];

    const prev = prevRef.current;
    const primeiraLeitura = Object.keys(prev).length === 0;
    const novosCaidos: { label: string; detalhe?: string }[] = [];

    for (const it of itens) {
      const antes = prev[it.key];
      // transição ok/verificando → erro (não dispara se já estava erro)
      if (it.status === 'erro' && antes && antes !== 'erro') {
        novosCaidos.push({ label: it.label, detalhe: it.detalhe });
      }
      prev[it.key] = it.status;
    }

    // Não alerta na primeira leitura (senão dispara pra tudo que já estava ruim)
    if (primeiraLeitura || !armado || novosCaidos.length === 0) return;

    if (ctxRef.current) tocarBeep(ctxRef.current);

    if ('Notification' in window && Notification.permission === 'granted') {
      const titulo =
        novosCaidos.length === 1
          ? `🔴 ${novosCaidos[0].label} caiu`
          : `🔴 ${novosCaidos.length} módulos caíram`;
      const corpo = novosCaidos.map((c) => `• ${c.label}${c.detalhe ? ` — ${c.detalhe}` : ''}`).join('\n');
      try {
        new Notification(titulo, { body: corpo, tag: 'flowforce-saude', requireInteraction: true });
      } catch {
        /* ignore */
      }
    }
  }, [data, armado]);

  // Lista do que está caído AGORA (pra banner)
  const caidos = data
    ? [
        ...data.bancos.filter((b) => b.status === 'erro').map((b) => ({ label: b.label, detalhe: b.erroMsg })),
        ...data.agentes.filter((a) => a.status === 'erro').map((a) => ({ label: a.label, detalhe: a.erroMsg })),
      ]
    : [];

  return { armado, armar, permissao, caidos };
}
