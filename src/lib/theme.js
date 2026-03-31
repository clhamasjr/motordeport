// ══════ THEME ══════
// All colors and design tokens from FlowForce v1
export const C = {
  bg: '#05080F',
  sf: '#0A1120',
  card: '#111827',
  brd: '#1E293B',
  acc: '#3B82F6',
  grn: '#22C55E',
  red: '#EF4444',
  ylw: '#EAB308',
  pur: '#A78BFA',
  org: '#F97316',
  pnk: '#EC4899',
  cyan: '#06B6D4',
  t1: '#F1F5F9',
  t2: '#94A3B8',
  t3: '#64748B',
};

// Global CSS injected once
export const globalCSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:${C.bg};color:${C.t1};font-family:'Inter','Segoe UI',system-ui,sans-serif;min-height:100vh;font-size:14px;line-height:1.5}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:${C.bg}}::-webkit-scrollbar-thumb{background:${C.brd};border-radius:3px}
::selection{background:${C.acc};color:#fff}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
button{font-family:inherit;cursor:pointer;transition:all .15s;border:none;background:none}button:hover{filter:brightness(1.15)}
input,select,textarea{font-family:inherit;outline:none;font-size:14px}
`;

// Pill classes
export const pillClass = (variant) => {
  const map = {
    acc: { bg: 'rgba(59,130,246,.12)', c: C.acc },
    grn: { bg: 'rgba(34,197,94,.14)', c: C.grn },
    red: { bg: 'rgba(239,68,68,.12)', c: C.red },
    ylw: { bg: 'rgba(234,179,8,.12)', c: C.ylw },
    pur: { bg: 'rgba(167,139,250,.12)', c: C.pur },
    org: { bg: 'rgba(249,115,22,.14)', c: C.org },
    pnk: { bg: 'rgba(236,72,153,.14)', c: C.pnk },
    cyan: { bg: 'rgba(6,182,212,.14)', c: C.cyan },
    default: { bg: 'rgba(255,255,255,.06)', c: C.t2 },
  };
  return map[variant] || map.default;
};

export const R$ = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const N = (v) => Number(v || 0).toLocaleString('pt-BR');
export const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
