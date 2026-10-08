// ══════════════════════════════════════════════════════════════════
// api/_lib/crefisa-situacao.js — situação da esteira Crefisa → estágio
//
// Compartilhado entre o worker da esteira (crefisa-esteira.js) e a tela do
// vendedor (crefisa-fila.js, action minhasPropostas).
// ══════════════════════════════════════════════════════════════════

// ── Normaliza a situação crua da Crefisa num estágio do funil ─────
// Por palavra-chave: aguenta variação de texto sem precisar da lista exata.
// cada estágio diz se é final (para de conferir) e se merece aviso.
export function classificarSituacao(bruto) {
  const s = String(bruto || '').toLowerCase();
  const tem = (...ks) => ks.some((k) => s.includes(k));

  if (tem('pago', 'paga', 'liberad', 'creditad', 'desembols')) {
    return { estagio: 'PAGA', final: true, avisar: 'sucesso', rotulo: 'Paga' };
  }
  if (tem('averbad', 'contrato efetiv', 'formaliz')) {
    return { estagio: 'FORMALIZADA', final: false, avisar: null, rotulo: 'Formalizada' };
  }
  if (tem('aprovad', 'deferid')) {
    return { estagio: 'APROVADA', final: false, avisar: null, rotulo: 'Aprovada' };
  }
  if (tem('pendent', 'pendência', 'pendencia', 'aguardando doc', 'documento')) {
    return { estagio: 'PENDENTE', final: false, avisar: 'pendencia', rotulo: 'Pendente' };
  }
  if (tem('cancelad', 'reprovad', 'recusad', 'indeferid', 'negad')) {
    return { estagio: 'CANCELADA', final: true, avisar: 'queda', rotulo: 'Cancelada/Reprovada' };
  }
  if (tem('anális', 'analise', 'em andamento', 'digitad')) {
    return { estagio: 'EM_ANALISE', final: false, avisar: null, rotulo: 'Em análise' };
  }
  return { estagio: 'OUTRO', final: false, avisar: null, rotulo: bruto || 'Situação desconhecida' };
}
