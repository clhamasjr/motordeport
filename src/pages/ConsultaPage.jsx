import React, { useState, useEffect } from 'react';
import { C, R$, N } from '../lib/theme';
import { consultaCPF, consultaBeneficio, joinbankIN100, consultaCartao as apiConsultaCartao } from '../lib/api';

// ── Styles
const S = {
  card: { background: C.card, borderRadius: 14, padding: 18, border: `1px solid ${C.brd}` },
  kpi: { background: C.card, borderRadius: 14, padding: '14px 16px', border: `1px solid ${C.brd}` },
  kpiLabel: { fontSize: 10, color: C.t3, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4, fontWeight: 600 },
  kpiValue: { fontSize: 20, fontWeight: 800 },
  pill: (variant) => {
    const map = { grn: { bg: 'rgba(34,197,94,.14)', c: C.grn }, red: { bg: 'rgba(239,68,68,.12)', c: C.red }, acc: { bg: 'rgba(59,130,246,.12)', c: C.acc }, pur: { bg: 'rgba(167,139,250,.12)', c: C.pur }, cyan: { bg: 'rgba(6,182,212,.14)', c: C.cyan }, ylw: { bg: 'rgba(234,179,8,.12)', c: C.ylw }, def: { bg: 'rgba(255,255,255,.06)', c: C.t2 } };
    const s = map[variant] || map.def;
    return { display: 'inline-block', padding: '3px 11px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.c };
  },
  btn: { padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: `1px solid ${C.brd}`, color: C.t2, background: 'transparent', cursor: 'pointer' },
  btnAcc: { padding: '10px 28px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'linear-gradient(135deg,#0EA5E9,#3B82F6)', color: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(59,130,246,.2)' },
  input: { width: '100%', padding: '13px 16px', borderRadius: 10, border: `1px solid ${C.brd}`, background: C.card, color: C.t1, fontSize: 14 },
};

// ── Saved history
function getHist() { try { return JSON.parse(localStorage.getItem('ff_consulta_hist') || '[]'); } catch { return []; } }
function saveHist(h) { localStorage.setItem('ff_consulta_hist', JSON.stringify(h.slice(0, 50))); }

// ══════ COMPONENT ══════
export default function ConsultaPage() {
  const [modo, setModo] = useState('cpf');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(getHist());

  // ── IN100 sub-state
  const [in100, setIn100] = useState(null);
  const [in100Loading, setIn100Loading] = useState(false);

  // ── Cartao sub-state
  const [cartaoData, setCartaoData] = useState(null);
  const [cartaoLoading, setCartaoLoading] = useState(false);

  const doConsulta = async (cpfOverride) => {
    const raw = cpfOverride || query.trim();
    if (!raw || raw.replace(/\D/g, '').length < 5) { alert('Informe um CPF ou Benefício válido'); return; }
    setLoading(true); setError(null); setResult(null); setIn100(null); setCartaoData(null);

    try {
      const data = modo === 'beneficio' ? await consultaBeneficio(raw) : await consultaCPF(raw.replace(/\D/g, ''));
      if (data.ok && data.parsed) {
        setResult(data.parsed);
        // Save to history
        const entry = { cpf: data.parsed.beneficiario?.cpf || raw, nome: data.parsed.beneficiario?.nome || '—', nb: data.parsed.beneficiario?.nb || '', date: new Date().toLocaleString('pt-BR') };
        const h = [entry, ...history.filter(x => x.cpf !== entry.cpf)].slice(0, 50);
        saveHist(h); setHistory(h);
      } else {
        setError(data.error || data.mensagem || 'Erro na consulta');
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const doIN100 = async (cpf, nb) => {
    if (!cpf || !nb) { alert('CPF e Benefício necessários'); return; }
    setIn100Loading(true); setIn100(null);
    try { const d = await joinbankIN100(cpf, nb); setIn100(d); } catch (e) { setIn100({ success: false, error: e.message }); }
    setIn100Loading(false);
  };

  const doCartao = async (cpf, ben) => {
    setCartaoLoading(true); setCartaoData(null);
    try { const d = await apiConsultaCartao(cpf, ben); setCartaoData(d); } catch (e) { setCartaoData({ success: false, error: e.message }); }
    setCartaoLoading(false);
  };

  // ══════ SEARCH BAR ══════
  const renderSearch = () => (
    <div style={{ maxWidth: 680, margin: '0 auto 24px' }}>
      <div style={{ fontSize: 22, fontWeight: 800, textAlign: 'center', marginBottom: 6 }}>🔍 Consulta INSS</div>
      <div style={{ fontSize: 13, color: C.t2, textAlign: 'center', marginBottom: 24 }}>Consulte extrato completo por CPF ou Benefício</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <select value={modo} onChange={e => setModo(e.target.value)} style={{ ...S.input, width: 140, flex: 'none' }}>
          <option value="cpf">CPF</option>
          <option value="beneficio">Benefício</option>
        </select>
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && doConsulta()}
          placeholder="Digite o CPF ou Nº Benefício..." style={{ ...S.input, flex: 1, fontSize: 16, padding: '14px 18px' }} />
        <button onClick={() => doConsulta()} style={{ ...S.btnAcc, padding: '14px 28px', fontSize: 14, whiteSpace: 'nowrap' }}>🔍 Consultar</button>
      </div>
    </div>
  );

  // ══════ RESULT ══════
  const renderResult = () => {
    if (!result) return null;
    const b = result.beneficiario || {};
    const ben = result.beneficio || {};
    const mrg = result.margem || {};
    const end = result.endereco || {};
    const bco = result.banco || {};
    const tels = result.telefones || [];
    const carts = result.cartoes || [];

    const fmtVal = (v) => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—';
    const tel1 = tels[0] || '';
    const wppNum = tel1 ? tel1.replace(/\D/g, '') : '';
    const wppLink = wppNum.length >= 10 ? 'https://wa.me/55' + wppNum : '';

    return (
      <div style={{ animation: 'fadeIn .35s ease both' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{b.nome || '—'}</div>
            <div style={{ fontSize: 13, fontFamily: 'monospace', color: C.t2, marginTop: 4 }}>
              CPF: {b.cpf || '—'} {b.nb && <>&nbsp;|&nbsp;Benefício: {b.nb}</>} {b.idade && <>&nbsp;|&nbsp;{b.idade}</>}
            </div>
            {b.nome_mae && <div style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>Mãe: {b.nome_mae}</div>}
            {b.rg && <div style={{ fontSize: 12, color: C.t3 }}>RG: {b.rg}</div>}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ben.situacao && <span style={S.pill(ben.situacao === 'ATIVO' ? 'grn' : 'red')}>{ben.situacao === 'ATIVO' ? '✅' : '⚠️'} {ben.situacao}</span>}
            {ben.desbloqueio && <span style={S.pill('acc')}>{ben.desbloqueio}</span>}
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 20 }}>
          <KPI label="Valor Benefício" value={fmtVal(ben.valor)} color={C.acc} />
          <KPI label="Base Cálculo" value={fmtVal(ben.base_calculo)} color={C.cyan} />
          <KPI label="Parcelas Emp." value={fmtVal(mrg.parcelas)} color={C.red} />
          <KPI label="Margem Livre" value={mrg.disponivel ? 'R$ ' + mrg.disponivel : '—'} color={C.grn} />
          <KPI label="RMC" value={'R$ ' + (mrg.rmc || '0,00')} color={C.pur} />
          <KPI label="RCC" value={'R$ ' + (mrg.rcc || '0,00')} color={C.pnk} />
        </div>

        {/* Ações */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, marginBottom: 20 }}>
          {wppLink ? <a href={wppLink} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}><ActionBtn color={C.cyan} icon="💬" label="WhatsApp" /></a>
            : <ActionBtn color={C.t3} icon="💬" label="Sem telefone" disabled />}
          <ActionBtn color={C.pur} icon="🔍" label="IN100" onClick={() => doIN100(b.cpf, b.nb)} />
          <ActionBtn color={C.grn} icon="💳" label="Saque Comp" onClick={() => doCartao(b.cpf, b.nb)} />
          <ActionBtn color={C.acc} icon="📋" label="Simular" onClick={() => alert('📋 Simulação — será migrada pro módulo Esteira')} />
          <ActionBtn color={C.ylw} icon="📝" label="Digitar" onClick={() => alert('📝 Digitação — módulo Esteira')} />
        </div>

        {/* Info grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.t2, marginBottom: 12 }}>📋 Benefício</div>
            <InfoRow label="Espécie" value={ben.especie} />
            <InfoRow label="Nascimento" value={b.data_nascimento} />
            <InfoRow label="DDB" value={ben.ddb} />
            <InfoRow label="Extrato" value={ben.data_extrato} />
          </div>
          <div style={S.card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.t2, marginBottom: 12 }}>🏦 Conta Pagadora</div>
            <InfoRow label="Banco" value={bco.nome} bold />
            <div style={{ display: 'flex', gap: 16 }}>
              <InfoRow label="Agência" value={bco.agencia} mono />
              <InfoRow label="Conta" value={bco.conta} mono />
            </div>
            <InfoRow label="Tipo" value={bco.tipo} />
          </div>
        </div>

        {/* Endereço */}
        {(end.uf || end.municipio || end.endereco) && (
          <div style={{ ...S.card, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.t2, marginBottom: 8 }}>📍 Endereço</div>
            <div style={{ fontSize: 13 }}>{end.endereco}{end.municipio && ` — ${end.municipio}`}{end.uf && `/${end.uf}`}{end.cep && ` — CEP: ${end.cep}`}</div>
          </div>
        )}

        {/* Telefones */}
        {tels.length > 0 && (
          <div style={{ ...S.card, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.t2, marginBottom: 10 }}>📱 Telefones ({tels.length})</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {tels.map((tel, i) => {
                const num = tel.replace(/\D/g, '');
                const wl = num.length >= 10 ? `https://wa.me/55${num}` : '';
                return (
                  <div key={i} style={{ background: C.sf, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700 }}>{tel}</span>
                    {wl && <a href={wl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}><span style={S.pill('grn')}>💬</span></a>}
                    <button style={{ ...S.btn, padding: '2px 6px', fontSize: 9 }} onClick={() => navigator.clipboard.writeText(tel)}>📋</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Cartões */}
        {carts.length > 0 && (
          <div style={{ ...S.card, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.t2, marginBottom: 10 }}>💳 Cartões ({carts.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
              {carts.map((c, i) => {
                const cor = c.tipo === 'RMC' ? C.pur : C.pnk;
                return (
                  <div key={i} style={{ background: C.sf, borderRadius: 10, padding: 14, border: `1px solid ${C.brd}`, borderLeft: `3px solid ${cor}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: cor }}>{c.tipo || '?'}</span>
                      <span style={{ fontSize: 12, color: C.t3 }}>{c.banco || ''}</span>
                    </div>
                    <InfoRow label="Margem" value={`R$ ${c.margem || '0,00'}`} color={c.margem !== '0,00' ? C.grn : C.red} />
                    <InfoRow label="Limite" value={`R$ ${c.limite || '0,00'}`} color={C.acc} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Contratos */}
        {result.contratos?.length > 0 && (
          <div style={{ ...S.card, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.t2, marginBottom: 10 }}>📑 Contratos ({result.contratos.length})</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {result.contratos.map((ct, i) => <span key={i} style={{ ...S.pill('acc'), fontFamily: 'monospace' }}>{ct.contrato || ct.id || '?'}</span>)}
            </div>
          </div>
        )}

        {/* IN100 result */}
        {in100Loading && <LoadingCard text="Consultando IN100..." icon="🔍" />}
        {in100 && !in100Loading && renderIN100()}

        {/* Cartão result */}
        {cartaoLoading && <LoadingCard text="Consultando cartões..." icon="💳" />}
        {cartaoData && !cartaoLoading && renderCartaoResult()}

        {/* Nova consulta */}
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button style={S.btn} onClick={() => { setResult(null); setIn100(null); setCartaoData(null); }}>🔍 Nova Consulta</button>
        </div>
      </div>
    );
  };

  // ── IN100 sub-render
  const renderIN100 = () => {
    if (!in100) return null;
    if (!in100.success) return (
      <div style={{ ...S.card, marginBottom: 16, textAlign: 'center', padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.red, marginBottom: 4 }}>❌ IN100 — Erro</div>
        <div style={{ fontSize: 13, color: C.t2 }}>{in100.error || 'Falha'}</div>
      </div>
    );
    return (
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.t2, marginBottom: 12 }}>🔍 IN100 — {in100.nome || '—'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8 }}>
          <KPI label="Status" value={in100.elegivel ? '✅ Elegível' : '❌ ' + (in100.benefitStatus || '')} color={in100.elegivel ? C.grn : C.red} small />
          <KPI label="Margem Emp" value={R$(in100.margemEmprestimo)} color={C.grn} small />
          <KPI label="Margem Cartão" value={R$(in100.margemCartao)} color={C.cyan} small />
          <KPI label="Saldo Disp." value={R$(in100.saldoDisponivel)} color={C.pur} small />
          <KPI label="Contr. Ativos" value={String(in100.contratosAtivos || 0)} color={C.acc} small />
          <KPI label="UF" value={in100.uf || '—'} color={C.t1} small />
        </div>
        {in100.bloqueado && <div style={{ background: 'rgba(239,68,68,.1)', border: `1px solid ${C.red}`, borderRadius: 8, padding: 10, marginTop: 10, fontSize: 12, color: C.red }}>⚠️ Bloqueio: {in100.tipoBlock}</div>}
      </div>
    );
  };

  // ── Cartao sub-render
  const renderCartaoResult = () => {
    if (!cartaoData) return null;
    if (!cartaoData.success) return (
      <div style={{ ...S.card, marginBottom: 16, textAlign: 'center', padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.red }}>❌ Cartão — Erro</div>
        <div style={{ fontSize: 13, color: C.t2 }}>{cartaoData.error || 'Falha'}</div>
      </div>
    );
    const totalDisp = (cartaoData.cartoes || []).reduce((s, c) => s + (c.limiteSaqueDisp || 0), 0);
    return (
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.t2, marginBottom: 12 }}>💳 Saque Complementar — {cartaoData.nome || '—'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8, marginBottom: 12 }}>
          <KPI label="Saque Disponível" value={R$(totalDisp)} color={C.grn} />
          <KPI label="Cartões" value={String((cartaoData.cartoes || []).length)} color={C.cyan} />
        </div>
        {(cartaoData.cartoes || []).map((c, i) => (
          <div key={i} style={{ background: C.sf, borderRadius: 10, padding: 14, marginBottom: 8, border: `1px solid ${C.brd}`, borderLeft: `3px solid ${C.acc}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 800, color: C.acc }}>{c.banco || '?'} — {c.produto || ''}</span>
              <span style={S.pill(c.statusCartao === 'ATIVO' || c.statusCartao === 'Ativo' ? 'grn' : 'red')}>{c.statusCartao || '?'}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              <InfoRow label="Limite" value={R$(c.limiteCartao || 0)} color={C.acc} />
              <InfoRow label="Saque Disp." value={R$(c.limiteSaqueDisp || 0)} color={(c.limiteSaqueDisp || 0) > 0 ? C.grn : C.t3} bold />
              <InfoRow label="Margem" value={R$(c.margem || 0)} color={C.cyan} />
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ── History
  const renderHistory = () => {
    if (result || loading || error || !history.length) return null;
    return (
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.t2 }}>📁 Últimas Consultas</div>
          <button style={{ ...S.btn, borderColor: C.red, color: C.red, fontSize: 11 }} onClick={() => { localStorage.removeItem('ff_consulta_hist'); setHistory([]); }}>Limpar</button>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {history.slice(0, 15).map((h, i) => (
            <div key={i} onClick={() => { setQuery(h.cpf); setModo('cpf'); setTimeout(() => doConsulta(h.cpf), 50); }}
              style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'background .1s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,.04)'}
              onMouseLeave={e => e.currentTarget.style.background = C.card}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{h.nome}</div>
                <div style={{ fontSize: 11, color: C.t2, fontFamily: 'monospace' }}>CPF: {h.cpf} {h.nb && `| Ben: ${h.nb}`}</div>
              </div>
              <div style={{ fontSize: 10, color: C.t3 }}>{h.date}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ══════ MAIN RENDER ══════
  return (
    <div>
      {renderSearch()}
      {loading && <LoadingCard text="Consultando benefício..." icon="📡" />}
      {error && !loading && (
        <div style={{ textAlign: 'center', padding: 40, background: C.card, borderRadius: 14, border: `1px solid ${C.brd}`, maxWidth: 500, margin: '0 auto', animation: 'fadeIn .35s ease' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>❌</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.red, marginBottom: 6 }}>Erro na Consulta</div>
          <div style={{ fontSize: 13, color: C.t2 }}>{error}</div>
          <button style={{ ...S.btn, marginTop: 14 }} onClick={() => setError(null)}>Tentar novamente</button>
        </div>
      )}
      {renderResult()}
      {renderHistory()}
    </div>
  );
}

// ══════ SUB-COMPONENTS ══════
function KPI({ label, value, color, small }) {
  return (
    <div style={{ background: C.card, borderRadius: small ? 8 : 14, padding: small ? '10px 12px' : '14px 16px', border: `1px solid ${C.brd}` }}>
      <div style={{ fontSize: small ? 9 : 10, color: C.t3, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: small ? 14 : 20, fontWeight: 800, color: color || C.t1 }}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value, color, bold, mono }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: C.t3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: bold ? 600 : 400, color: color || C.t1, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
    </div>
  );
}

function ActionBtn({ color, icon, label, onClick, disabled }) {
  return (
    <button disabled={disabled} onClick={onClick} style={{
      width: '100%', padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
      border: `1px solid ${color}`, color: color, background: 'transparent', cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.4 : 1,
    }}>{icon} {label}</button>
  );
}

function LoadingCard({ text, icon }) {
  return (
    <div style={{ textAlign: 'center', padding: 60, animation: 'fadeIn .35s ease' }}>
      <div style={{ fontSize: 36, animation: 'pulse 1.2s ease infinite', marginBottom: 12 }}>{icon || '📡'}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{text}</div>
      <div style={{ fontSize: 12, color: C.t3, marginTop: 6 }}>Aguarde alguns segundos</div>
    </div>
  );
}
