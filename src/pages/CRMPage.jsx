import React from 'react';
import { C } from '../lib/theme';

export default function CRMPage() {
  return (
    <div style={{ animation: 'fadeIn .35s ease both' }}>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>📋 CRM & Disparo</div>
      <div style={{ fontSize: 13, color: C.t2, marginBottom: 24 }}>Campanhas, disparo WhatsApp, acompanhamento de clientes</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
        {[
          { icon: '📋', title: 'Campanhas', desc: 'Crie e gerencie campanhas por tipo de operação', status: '⏳ Migração pendente' },
          { icon: '📤', title: 'Disparo WhatsApp', desc: 'Templates, disparo em lote via Evolution API', status: '⏳ Migração pendente' },
          { icon: '💬', title: 'Chat WhatsApp', desc: 'Conversas em tempo real dentro do sistema', status: '⏳ Migração pendente' },
          { icon: '🏷️', title: 'Etiquetas CRM', desc: 'Fechado, negociação, sem sucesso, aguardando...', status: '⏳ Migração pendente' },
          { icon: '📱', title: 'Conexões', desc: 'Gerenciar instâncias Evolution API + QR Code', status: '⏳ Migração pendente' },
          { icon: '📊', title: 'Relatórios', desc: 'Performance por operador, taxa de conversão', status: '🆕 Novo' },
        ].map((f, i) => (
          <div key={i} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 22 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>{f.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{f.title}</div>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 10 }}>{f.desc}</div>
            <span style={{ fontSize: 11, color: f.status.includes('Novo') ? C.grn : C.ylw, background: f.status.includes('Novo') ? 'rgba(34,197,94,.1)' : 'rgba(234,179,8,.1)', padding: '3px 10px', borderRadius: 6 }}>{f.status}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 32, textAlign: 'center', padding: 40, background: C.sf, borderRadius: 16, border: `1px solid ${C.brd}` }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Módulo em migração</div>
        <div style={{ fontSize: 13, color: C.t2 }}>Campanhas, CRM e WhatsApp serão migrados do v1.</div>
      </div>
    </div>
  );
}
