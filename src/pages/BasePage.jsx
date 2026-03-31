import React from 'react';
import { C } from '../lib/theme';

export default function BasePage() {
  return (
    <div style={{ animation: 'fadeIn .35s ease both' }}>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>📊 Base & Análise</div>
      <div style={{ fontSize: 13, color: C.t2, marginBottom: 24 }}>Upload de base offline, motor de portabilidade, RMC/RCC, dashboard</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
        {[
          { icon: '📤', title: 'Upload Base XLSX', desc: 'Suba a base completa do offline p/ análise automática', status: '⏳ Migração pendente' },
          { icon: '📊', title: 'Dashboard', desc: 'KPIs, mapa de bancos, distribuição de taxas', status: '⏳ Migração pendente' },
          { icon: '✅', title: 'Elegíveis', desc: 'Lista de contratos elegíveis com seleção em massa', status: '⏳ Migração pendente' },
          { icon: '💳', title: 'RMC / RCC', desc: 'Cartão consignado, margem disponível, saque complementar', status: '⏳ Migração pendente' },
          { icon: '🔄', title: 'Pipeline', desc: 'Fluxo de seleção → higienização → WhatsApp', status: '⏳ Migração pendente' },
          { icon: '🗺️', title: 'Mapa de Bancos', desc: 'Destinos QUALI, FACTA, BRB, DIGIO com regras', status: '⏳ Migração pendente' },
        ].map((f, i) => (
          <div key={i} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 22 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>{f.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{f.title}</div>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 10 }}>{f.desc}</div>
            <span style={{ fontSize: 11, color: C.ylw, background: 'rgba(234,179,8,.1)', padding: '3px 10px', borderRadius: 6 }}>{f.status}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 32, textAlign: 'center', padding: 40, background: C.sf, borderRadius: 16, border: `1px solid ${C.brd}` }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Módulo em migração</div>
        <div style={{ fontSize: 13, color: C.t2, maxWidth: 400, margin: '0 auto' }}>
          O motor de análise offline será migrado do index.html v1 pra cá. Toda a lógica de portabilidade, RMC/RCC e pipeline será preservada.
        </div>
        <div style={{ fontSize: 12, color: C.t3, marginTop: 12 }}>
          Enquanto isso, use a <strong style={{ color: C.acc }}>versão v1</strong> (index.html) pra upload de base.
        </div>
      </div>
    </div>
  );
}
