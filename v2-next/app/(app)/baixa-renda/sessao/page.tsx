'use client';

// ════════════════════════════════════════════════════════════════════
// Baixa Renda — Sessão do portal Crefisa
//
// O portal da Crefisa (2tech) exige reCAPTCHA + 2FA no login, então o
// robô não entra sozinho. O dono loga no navegador, clica em "Copiar
// capturador", cola no console do portal, e cola o resultado aqui.
// Vale o dia todo.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { useCrefisaSessao, useCrefisaColarSessao } from '@/hooks/use-crefisa-br';
import { KeyRound, Copy, CheckCircle2, AlertCircle, Loader2, ExternalLink, MousePointerClick } from 'lucide-react';
import { toast } from 'sonner';

const PORTAL = 'https://app1.gerencialcredito.com.br/CREFISA/simuladorCrefisa.asp';

// Botão de favorito (bookmarklet): o dono arrasta pra barra uma vez e, com o
// portal logado, 1 clique copia a sessão pra área de transferência — sem F12.
// Lê o token do localStorage + o cookie + o código do usuário digitador.
const BOOKMARKLET =
  "javascript:(async()=>{try{" +
  "var b='/CREFISA/ajax_crefisa.asp?combo=';" +
  "var v=await fetch(b+'GetVendedorId').then(function(r){return r.json()});" +
  "var u=await fetch(b+'GetUsuarios&nomeUsuario=&vendedorId='+v.vendedorId).then(function(r){return r.json()});" +
  "var j=JSON.stringify({bearer:localStorage.getItem(btoa('accessToken-'+_SEGURANCA.cod+'-'+_SEGURANCA.uId))||'',cookie:document.cookie,versaoSistema:String(_SEGURANCA.versaoSistema||''),cod:String(_SEGURANCA.cod||''),vendedorId:v.vendedorId||null,codigoUsuarioParceiro:(u.usuarios&&u.usuarios[0]&&u.usuarios[0].codigo)||''});" +
  "await navigator.clipboard.writeText(j);" +
  "alert('Sessao Crefisa copiada! Volte ao FlowForce e cole (Ctrl+V).');" +
  "}catch(e){alert('Abra o portal logado e clique de novo. '+e.message);}})()";

// Fallback: mesmo capturador pra quem prefere colar no console (F12).
const CAPTURADOR = `const _vid = await fetch('ajax_crefisa.asp?combo=GetVendedorId').then(r => r.json());
const _us = await fetch('ajax_crefisa.asp?combo=GetUsuarios&nomeUsuario=&vendedorId=' + _vid.vendedorId).then(r => r.json());
copy(JSON.stringify({
  bearer: localStorage.getItem(btoa('accessToken-' + _SEGURANCA.cod + '-' + _SEGURANCA.uId)) || '',
  cookie: document.cookie,
  versaoSistema: String(_SEGURANCA.versaoSistema || ''),
  cod: String(_SEGURANCA.cod || ''),
  vendedorId: _vid.vendedorId || null,
  codigoUsuarioParceiro: (_us.usuarios && _us.usuarios[0] && _us.usuarios[0].codigo) || ''
})); console.log('✅ Sessão copiada — cole no FlowForce');`;

export default function BaixaRendaSessaoPage() {
  const sessao = useCrefisaSessao();
  const colar = useCrefisaColarSessao();
  const [texto, setTexto] = useState('');
  const [verConsole, setVerConsole] = useState(false);

  // React sanitiza href="javascript:" — então setamos via ref depois do mount.
  const botaoFavorito = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (botaoFavorito.current) botaoFavorito.current.setAttribute('href', BOOKMARKLET);
  }, []);

  const copiarCapturador = () => {
    navigator.clipboard.writeText(CAPTURADOR).then(
      () => toast.success('Capturador copiado — cole no console do portal (F12)'),
      () => toast.error('Não consegui copiar'),
    );
  };

  const salvar = async () => {
    let dados: Record<string, string | number | null>;
    try {
      dados = JSON.parse(texto);
    } catch {
      toast.error('Isso não parece o JSON do capturador — copie de novo no portal');
      return;
    }
    if (!dados.bearer || !dados.cookie) {
      toast.error('Faltou o token ou o cookie — rode o capturador com o portal aberto e logado');
      return;
    }
    const r = await colar.mutateAsync({
      bearer: String(dados.bearer),
      cookie: String(dados.cookie),
      versaoSistema: dados.versaoSistema ? String(dados.versaoSistema) : undefined,
      cod: dados.cod ? String(dados.cod) : undefined,
      vendedorId: dados.vendedorId ? Number(dados.vendedorId) : undefined,
      codigoUsuarioParceiro: dados.codigoUsuarioParceiro ? String(dados.codigoUsuarioParceiro) : undefined,
    }).catch(() => null);
    if (r?.success) {
      setTexto('');
      toast.success('Sessão salva — motor Baixa Renda ativo');
      sessao.refetch();
    }
  };

  const viva = sessao.data?.viva;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <KeyRound className="size-6 text-emerald-400" /> Sessão do portal Crefisa
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          O portal pede 2FA no login, então o robô não entra sozinho. Cole a sessão aqui
          de manhã e o motor opera o dia todo.
        </p>
      </div>

      {/* Status */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status atual:</span>
            {sessao.isPending ? (
              <Badge variant="info" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" /> VERIFICANDO</Badge>
            ) : viva ? (
              <Badge variant="success" className="gap-1"><CheckCircle2 className="w-3 h-3" /> ATIVA</Badge>
            ) : (
              <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" /> {sessao.data?.sessao === 'sem-sessao' ? 'NUNCA COLADA' : 'EXPIRADA'}</Badge>
            )}
          </div>
          {sessao.data?.atualizadoEm && (
            <span className="text-[11px] text-muted-foreground">
              colada em {new Date(sessao.data.atualizadoEm).toLocaleString('pt-BR')}
            </span>
          )}
        </CardContent>
      </Card>

      {/* Passo a passo */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="flex items-center justify-center size-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold">1</span>
              Abra o portal e faça login
            </div>
            <Button size="sm" variant="outline" asChild className="ml-7">
              <a href={PORTAL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" /> Abrir portal Crefisa
              </a>
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="flex items-center justify-center size-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold">2</span>
              Uma vez só: arraste o botão abaixo pra barra de favoritos
            </div>
            <div className="ml-7 space-y-1.5">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a
                ref={botaoFavorito}
                href="#"
                onClick={(e) => { e.preventDefault(); toast.info('Não clique aqui — ARRASTE este botão pra barra de favoritos do navegador'); }}
                draggable
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 font-medium text-sm cursor-grab active:cursor-grabbing select-none"
              >
                <MousePointerClick className="w-4 h-4" /> Capturar Sessão Crefisa
              </a>
              <p className="text-[11px] text-muted-foreground">
                Segure e arraste pra barra de favoritos (onde ficam seus atalhos). Depois,
                com o portal aberto e logado, é só <b>clicar nele</b> — a sessão é copiada sozinha.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="flex items-center justify-center size-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold">3</span>
              Cole aqui o que foi copiado (Ctrl+V)
            </div>
            <div className="ml-7 space-y-2">
              <Label className="text-[11px] text-muted-foreground">Sessão capturada</Label>
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder='{"bearer":"...","cookie":"..."}'
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono scrollbar-thin"
              />
              <Button onClick={salvar} disabled={!texto.trim() || colar.isPending}>
                {colar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Salvar sessão
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modo avançado: console (fallback) */}
      <div className="space-y-2">
        <button
          onClick={() => setVerConsole((v) => !v)}
          className="text-[11px] text-muted-foreground underline hover:text-foreground"
        >
          {verConsole ? 'esconder' : 'o botão não funcionou? usar o console (F12)'}
        </button>
        {verConsole && (
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="text-[11px] text-muted-foreground">
                No portal logado, aperte <b>F12</b>, vá em <b>Console</b>, copie o código abaixo,
                cole lá e dê Enter (se o Chrome pedir, digite <b>allow pasting</b> antes). Depois
                cole aqui em cima.
              </p>
              <Button size="sm" variant="outline" onClick={copiarCapturador}>
                <Copy className="w-3.5 h-3.5" /> Copiar código do console
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        A sessão fica guardada só no banco do FlowForce e nunca aparece em tela — o painel
        mostra no máximo os primeiros caracteres pra você conferir que salvou.
      </p>
    </div>
  );
}
