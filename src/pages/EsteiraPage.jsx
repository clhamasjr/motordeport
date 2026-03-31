import React from 'react';
import { C } from '../lib/theme';

export default function EsteiraPage() {
  return (
    <div style={{ animation: 'fadeIn .35s ease both' }}>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>📝 Esteira de Propostas</div>
      <div style={{ fontSize: 13, color: C.t2, marginBottom: 24 }}>Digitação, simulação, acompanhamento de propostas</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
        {[
          { icon: '📋', title: 'Simulação', desc: 'Simular operações FACTA + JoinBank com tabelas reais', status: '⏳ Migração pendente' },
          { icon: '📝', title: 'Digitação Multi-Step', desc: 'Formulário completo p/ digitar proposta na FACTA', status: '🆕 Próximo' },
          { icon: '📊', title: 'Esteira FACTA', desc: 'Acompanhar propostas em andamento (1.413+ na fila)', status: '🆕 Próximo' },
          { icon: '🔍', title: 'IN100 / DATAPREV', desc: 'Consulta JoinBank — elegibilidade, margem, bloqueios', status: '⏳ Migração pendente' },
          { icon: '💳', title: 'Saque Complementar', desc: 'DataConsulta BMG/Daycoval — saldo, limite, saque', status: '⏳ Migração pendente' },
          { icon: '📦', title: 'Averbação', desc: 'Acompanhamento pós-digitação: CIP, averbação, pago', status: '🆕 Novo' },
        ].map((f, i) => (
          <div key={i} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 22 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>{f.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{f.title}</div>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 10 }}>{f.desc}</div>
            <span style={{ fontSize: 11, color: f.status.includes('Próximo') ? C.org : f.status.includes('Novo') ? C.grn : C.ylw, background: f.status.includes('Próximo') ? 'rgba(249,115,22,.1)' : f.status.includes('Novo') ? 'rgba(34,197,94,.1)' : 'rgba(234,179,8,.1)', padding: '3px 10px', borderRadius: 6 }}>{f.status}</span>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
        <div style={{ background: 'linear-gradient(135deg,rgba(59,130,246,.08),rgba(6,182,212,.04))', border: `2px solid rgba(59,130,246,.2)`, borderRadius: 16, padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.acc, marginBottom: 8 }}>📝 Digitação FACTA</div>
          <div style={{ fontSize: 13, color: C.t2, marginBottom: 16 }}>
            Novo Digital (13), Margem Complementar (27), Refin (14), Portabilidade CIP (003500), Cartão (33)
          </div>
          <div style={{ fontSize: 12, color: C.org, fontWeight: 700 }}>⏳ Em construção — próxima sessão</div>
        </div>
        <div style={{ background: 'linear-gradient(135deg,rgba(167,139,250,.08),rgba(236,72,153,.04))', border: `2px solid rgba(167,139,250,.2)`, borderRadius: 16, padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.pur, marginBottom: 8 }}>📊 Esteira de Propostas</div>
          <div style={{ fontSize: 13, color: C.t2, marginBottom: 16 }}>
            Acompanhamento em tempo real via FACTA esteira API. Status, pagamento, cancelamento.
          </div>
          <div style={{ fontSize: 12, color: C.org, fontWeight: 700 }}>⏳ Em construção — próxima sessão</div>
        </div>
      </div>

      <div style={{ marginTop: 32, textAlign: 'center', padding: 40, background: C.sf, borderRadius: 16, border: `1px solid ${C.brd}` }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📝</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Próximo módulo a construir</div>
        <div style={{ fontSize: 13, color: C.t2, maxWidth: 500, margin: '0 auto' }}>
          Digitação multi-step + esteira FACTA. A sessão anterior deixou a API FACTA pronta com 16 actions — falta o formulário frontend.
        </div>
      </div>
    </div>
  );
}
