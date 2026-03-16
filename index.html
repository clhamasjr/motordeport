import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase.js'
import * as XLSX from 'xlsx'

/* ═══ THEME ═══ */
const C={bg:'#0A0E17',surface:'#0F1520',card:'#141B2B',border:'#1C2538',text:'#DAE0ED',muted:'#5B6B85',accent:'#3B82F6',accent2:'#10B981',warn:'#F59E0B',danger:'#EF4444',info:'#38BDF8',abg:'#3B82F622'}
const NOW=new Date(),CUR_M=NOW.toISOString().slice(0,7),PREV_M=new Date(NOW.getFullYear(),NOW.getMonth()-1,1).toISOString().slice(0,7)

/* ═══ UTILS ═══ */
const fmtCur=v=>'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})
const fmtDate=d=>{if(!d)return'—';const p=String(d).split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:d}
const PROD_SIT=['CONCRETIZADO','CRC CLIENTE','PAGO','INTEGRADA','PAGO C/PENDÊNCIA','PAGO C/PENDENCIA','PORTABILIDADE AVERBADA']
const PROD_SITB=['FINALIZADO','PAGO','PAGA','AVERBADO','CONCRETIZADO','INTEGRADA','INTEGRADO','INT - FINALIZADO','INT - FINALIZADO REFIN','INT - TED EMITIDA','PAGO AO CLIENTE','PAGO C/PENDÊNCIA','PAGO C/PENDENCIA','PAGAMENTO REALIZADO','FINALIZADO / PAGO','PAGO - CRÉDITO ENVIADO','PORTABILIDADE AVERBADA']
const isFin=o=>PROD_SIT.includes((o.situacao||'').toUpperCase())||PROD_SITB.includes((o.situacaoBanco||'').toUpperCase())
const isEst=o=>{const s=(o.situacao||'').toUpperCase(),sb=(o.situacaoBanco||'').toUpperCase();return['ESTORNADO','CANCELADO','CANCELADA','RECUSADA','REPROVADA','REPROVADO','NEGADO','NEGADA','PROPOSTA REPROVADA','CANCELADO PELO CLIENTE'].includes(s)||['CANCELADO','CANCELADA','REPROVADA','REPROVADO','NEGADA','REPROVADA - FINALIZADA','REPROVADO CRÉDITO'].includes(sb)}
const isPend=o=>!isFin(o)&&!isEst(o)
const sitCol=s=>{s=(s||'').toUpperCase();if(['FINALIZADO','PAGO','AVERBADO','APROVADO','CONCRETIZADO','INTEGRADA','INTEGRADO','CRC CLIENTE','PAGA','PAGAMENTO REALIZADO'].includes(s))return C.accent2;if(['ESTORNADO','CANCELADO','CANCELADA','RECUSADA','REPROVADA','REPROVADO','NEGADO','NEGADA','PROPOSTA REPROVADA'].includes(s))return C.danger;if(['EM ANÁLISE','EM ANALISE','PENDENTE','ANALISE BANCO','ANDAMENTO','AGUARDANDO RETORNO CIP','PROPOSTA CADASTRADA','ASSINADO CCB'].includes(s))return C.warn;return C.info}
function nDate(v){if(!v)return'';if(typeof v==='number'){const d=new Date(Math.round((v-25569)*86400*1000));return!isNaN(d.getTime())?d.toISOString().split('T')[0]:''}const s=String(v).trim(),m=s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);if(m)return(m[3].length===2?'20'+m[3]:m[3])+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);return''}
function pNum(v){if(v==null||v==='')return 0;if(typeof v==='number')return v;return parseFloat(String(v).replace(/[R$\s.]/g,'').replace(',','.'))||0}
const fixDate=v=>{if(!v)return'';const s=String(v).trim();return s.length>=10&&s[4]==='-'?s.slice(0,10):s}
const fromDb=r=>({id:r.id,id_ext:r.id_ext||'',banco:r.banco||'',cpf:r.cpf||'',cliente:r.cliente||'',proposta:r.proposta||'',contrato:r.contrato||'',data:fixDate(r.data),prazo:r.prazo||'',vrBruto:Number(r.vr_bruto)||0,vrParcela:Number(r.vr_parcela)||0,vrLiquido:Number(r.vr_liquido)||0,vrRepasse:Number(r.vr_repasse)||0,vrSeguro:Number(r.vr_seguro)||0,taxa:r.taxa||'',operacao:r.operacao||'',situacao:r.situacao||'',produto:r.produto||'',convenio:r.convenio||'',agente:r.agente||'',situacaoBanco:r.situacao_banco||'',obsSituacao:r.obs_situacao||'',usuario:r.usuario||'',crcCliente:fixDate(r.crc_cliente),dataNossoCredito:fixDate(r.data_nosso_credito)})
const toDb=o=>({id_ext:o.id_ext||'',banco:o.banco||'',cpf:o.cpf||'',cliente:o.cliente||'',proposta:o.proposta||'',contrato:o.contrato||'',data:o.data||null,prazo:o.prazo||'',vr_bruto:o.vrBruto||0,vr_parcela:o.vrParcela||0,vr_liquido:o.vrLiquido||0,vr_repasse:o.vrRepasse||0,vr_seguro:o.vrSeguro||0,taxa:o.taxa||'',operacao:o.operacao||'',situacao:o.situacao||'',produto:o.produto||'',convenio:o.convenio||'',agente:o.agente||'',situacao_banco:o.situacaoBanco||'',obs_situacao:o.obsSituacao||'',usuario:o.usuario||'',crc_cliente:o.crcCliente||null,data_nosso_credito:o.dataNossoCredito||null})

/* ═══ PERIODS ═══ */
const PERIODS=(()=>{const y=NOW.getFullYear(),m=NOW.getMonth(),d=(a,b)=>new Date(a,b,1).toISOString().split('T')[0],e=(a,b)=>new Date(a,b+1,0).toISOString().split('T')[0];return{mes:{n:'Mês Atual',f:d(y,m),t:e(y,m)},ant:{n:'Mês Anterior',f:d(y,m-1),t:e(y,m-1)},tri:{n:'Trimestre',f:d(y,m-2),t:e(y,m)},sem:{n:'Semestre',f:d(y,m-5),t:e(y,m)},ano:{n:String(y),f:y+'-01-01',t:y+'-12-31'},tudo:{n:'Tudo',f:'2000-01-01',t:'2099-12-31'}}})()

/* ═══ SERVER-SIDE FETCH ═══ */
async function fetchOps(per,onProgress,customDf,customDt){
  let df,dt
  if(per==='custom'){df=customDf||'2000-01-01';dt=customDt||'2099-12-31'}
  else{const r=PERIODS[per]||PERIODS.tudo;df=r.f;dt=r.t}
  const PAGE=1000;let all=[],from=0
  while(true){
    let q=supabase.from('digitacoes').select('*').range(from,from+PAGE-1)
    if(per!=='tudo')q=q.gte('data',df).lte('data',dt)
    const{data,error}=await q
    if(error||!data||data.length===0)break
    all=all.concat(data);if(onProgress)onProgress(all.length)
    if(data.length<PAGE)break;from+=PAGE
  }
  return all.map(fromDb)
}

/* ═══ FETCH PRODUCTION — by CRC date ═══ */
async function fetchProd(per,onProgress,customDf,customDt){
  let df,dt
  if(per==='custom'){df=customDf||'2000-01-01';dt=customDt||'2099-12-31'}
  else{const r=PERIODS[per]||PERIODS.tudo;df=r.f;dt=r.t}
  const PAGE=1000;let all=[],from=0
  while(true){
    let q=supabase.from('digitacoes').select('*')
      .in('situacao',['CONCRETIZADO','CRC CLIENTE','PAGO','INTEGRADA','PAGO C/PENDÊNCIA','PORTABILIDADE AVERBADA'])
      .range(from,from+PAGE-1)
    if(per!=='tudo')q=q.gte('crc_cliente',df).lte('crc_cliente',dt)
    const{data,error}=await q
    if(error){console.error('fetchProd err:',error);break}
    if(!data||!data.length)break
    all=all.concat(data);if(onProgress)onProgress(all.length)
    if(data.length<PAGE)break;from+=PAGE
  }
  return all.map(fromDb)
}

/* ═══ FETCH RECEIVABLES — all with CRC filled ═══ */
async function fetchReceb(){
  const PAGE=1000;let all=[],from=0
  while(true){
    const{data,error}=await supabase.from('digitacoes').select('*')
      .in('situacao',['CONCRETIZADO','CRC CLIENTE','PAGO','INTEGRADA','PAGO C/PENDÊNCIA','PORTABILIDADE AVERBADA'])
      .not('crc_cliente','is',null)
      .range(from,from+PAGE-1)
    if(error){console.error('fetchReceb err:',error);break}
    if(!data||!data.length)break
    all=all.concat(data)
    if(data.length<PAGE)break;from+=PAGE
  }
  return all.map(fromDb)
}

/* ═══ BUSINESS DAYS + PROJECTION by CRC ═══ */
function countBD(s,e){let c=0;const d=new Date(s);while(d<=e){if(d.getDay()!==0&&d.getDay()!==6)c++;d.setDate(d.getDate()+1)}return c}
function getBD(dateStr){if(!dateStr)return 0;return countBD(new Date(dateStr),NOW)}
function getAgingKey(bd){return bd<=5?'0-5':bd<=10?'5-10':bd<=15?'10-15':bd<=30?'15-30':bd<=60?'30-60':bd<=90?'60-90':'90+'}
function getProj(prodOps){
  const y=NOW.getFullYear(),m=NOW.getMonth(),f=new Date(y,m,1),l=new Date(y,m+1,0),ye=new Date(NOW);ye.setDate(ye.getDate()-1)
  const duT=countBD(f,l),duP=countBD(f,ye<f?f:ye),duR=duT-duP
  // prodOps already filtered by CRC in current month
  const fR=prodOps.reduce((s,o)=>s+(o.vrRepasse||0),0),fC=prodOps.length
  const mdR=duP>0?fR/duP:0,mdD=duP>0?fC/duP:0
  return{duT,duP,duR,fR,fC,mdR,mdD,pR:mdR*duT,pD:Math.round(mdD*duT)}
}

/* ═══ UI ATOMS ═══ */
function Stat({label,value,sub,color,small}){return<div style={{background:C.card,border:'1px solid '+C.border,borderRadius:12,padding:small?'10px 12px':'14px 16px',flex:1,minWidth:small?90:120}}><div style={{fontSize:small?8:9,color:C.muted,marginBottom:3,fontWeight:600,textTransform:'uppercase'}}>{label}</div><div style={{fontSize:small?14:18,fontWeight:700,color:color||C.text}}>{value}</div>{sub&&<div style={{fontSize:small?9:10,color:C.muted,marginTop:2}}>{sub}</div>}</div>}
function Badge({text,color}){return<span style={{fontSize:10,padding:'2px 8px',borderRadius:6,background:color+'22',color,fontWeight:600}}>{text}</span>}
function PeriodBar({per,setPer,loading,customDf,customDt,setCustomDf,setCustomDt,onApplyCustom}){
  return<div style={{display:'flex',flexDirection:'column',gap:6}}>
    <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
      {Object.entries(PERIODS).map(([k,v])=><button key={k} onClick={()=>setPer(k)} disabled={loading} style={{padding:'5px 12px',borderRadius:6,fontFamily:'Outfit,sans-serif',fontSize:10,border:'1px solid '+(per===k?C.accent:C.border),background:per===k?C.abg:'transparent',color:per===k?C.accent:C.muted,fontWeight:per===k?700:400,cursor:loading?'wait':'pointer',opacity:loading?.5:1}}>{v.n}</button>)}
      <button onClick={()=>setPer('custom')} disabled={loading} style={{padding:'5px 12px',borderRadius:6,fontFamily:'Outfit,sans-serif',fontSize:10,border:'1px solid '+(per==='custom'?C.accent:C.border),background:per==='custom'?C.abg:'transparent',color:per==='custom'?C.accent:C.muted,fontWeight:per==='custom'?700:400,cursor:loading?'wait':'pointer'}}>📅 Personalizado</button>
      {loading&&<span style={{fontSize:10,color:C.warn,marginLeft:8}}>⏳</span>}
    </div>
    {per==='custom'&&<div style={{display:'flex',gap:8,alignItems:'end'}}>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>DE</label><input type="date" value={customDf||''} onChange={e=>setCustomDf&&setCustomDf(e.target.value)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'6px 10px',fontSize:11,fontFamily:'Outfit,sans-serif'}}/></div>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>ATÉ</label><input type="date" value={customDt||''} onChange={e=>setCustomDt&&setCustomDt(e.target.value)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'6px 10px',fontSize:11,fontFamily:'Outfit,sans-serif'}}/></div>
      <button onClick={()=>onApplyCustom&&onApplyCustom()} style={{background:C.accent,color:'#fff',border:'none',borderRadius:7,padding:'7px 16px',fontSize:11,fontWeight:600,cursor:'pointer'}}>Aplicar</button>
    </div>}
  </div>
}

/* ═══ EXPORT XLSX ═══ */
function exportXlsx(ops,filename){
  const ws=XLSX.utils.json_to_sheet(ops.map(o=>({Data:o.data,Banco:o.banco,CPF:o.cpf,Cliente:o.cliente,Proposta:o.proposta,'Operação':o.operacao,'Situação':o.situacao,'Sit.Banco':o.situacaoBanco,'Convênio':o.convenio,Agente:o.agente,Repasse:o.vrRepasse,Bruto:o.vrBruto,Líquido:o.vrLiquido,Parcela:o.vrParcela,CRC:o.crcCliente,'Nosso Crédito':o.dataNossoCredito})))
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Dados');XLSX.writeFile(wb,filename+'.xlsx')
}
function ExportBtn({ops,name}){return<button onClick={()=>exportXlsx(ops,name||'export')} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:8,color:C.text,padding:'6px 14px',cursor:'pointer',fontWeight:600,fontSize:11}}>📤 ({ops.length})</button>}

function ExportModal({open,onClose,ops}){
  const[fBanco,sFBanco]=useState(''),[fAgente,sFAgente]=useState(''),[fOp,sFOp]=useState(''),[fSit,sFSit]=useState(''),[fConv,sFConv]=useState('')
  if(!open)return null
  const bancos=[...new Set(ops.map(o=>o.banco).filter(Boolean))].sort()
  const agentes=[...new Set(ops.map(o=>o.agente).filter(Boolean))].sort()
  const operacoes=[...new Set(ops.map(o=>o.operacao).filter(Boolean))].sort()
  const situacoes=[...new Set(ops.map(o=>o.situacao).filter(Boolean))].sort()
  const convenios=[...new Set(ops.map(o=>o.convenio).filter(Boolean))].sort()
  const fd=ops.filter(o=>(!fBanco||o.banco===fBanco)&&(!fAgente||o.agente===fAgente)&&(!fOp||o.operacao===fOp)&&(!fSit||o.situacao===fSit)&&(!fConv||o.convenio===fConv))
  const sel=s=>({background:C.surface,border:'1px solid '+C.border,borderRadius:6,color:C.text,padding:'6px 10px',fontSize:11,width:'100%'})
  return<div style={{position:'fixed',inset:0,background:'#000c',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:'1px solid '+C.border,borderRadius:18,width:640,maxWidth:'95vw',maxHeight:'90vh',overflowY:'auto'}}>
      <div style={{padding:'16px 22px',borderBottom:'1px solid '+C.border,display:'flex',justifyContent:'space-between'}}><h3 style={{fontWeight:700,fontSize:15,margin:0}}>Exportar com Filtros</h3><button onClick={onClose} style={{background:'none',border:'none',color:C.muted,fontSize:22,cursor:'pointer'}}>×</button></div>
      <div style={{padding:'16px 22px',display:'flex',flexDirection:'column',gap:12}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
          <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>BANCO</label><select value={fBanco} onChange={e=>sFBanco(e.target.value)} style={sel()}><option value="">Todos</option>{bancos.map(b=><option key={b} value={b}>{b}</option>)}</select></div>
          <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>PARCEIRO</label><select value={fAgente} onChange={e=>sFAgente(e.target.value)} style={sel()}><option value="">Todos</option>{agentes.map(a=><option key={a} value={a}>{a}</option>)}</select></div>
          <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>OPERAÇÃO</label><select value={fOp} onChange={e=>sFOp(e.target.value)} style={sel()}><option value="">Todas</option>{operacoes.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
          <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>SITUAÇÃO</label><select value={fSit} onChange={e=>sFSit(e.target.value)} style={sel()}><option value="">Todas</option>{situacoes.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>CONVÊNIO</label><select value={fConv} onChange={e=>sFConv(e.target.value)} style={sel()}><option value="">Todos</option>{convenios.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
          <div style={{display:'flex',alignItems:'end'}}><button onClick={()=>{sFBanco('');sFAgente('');sFOp('');sFSit('');sFConv('')}} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:6,color:C.muted,padding:'6px 12px',fontSize:11,cursor:'pointer',width:'100%'}}>Limpar</button></div>
        </div>
        <div style={{background:C.surface,borderRadius:10,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div><strong style={{color:C.accent}}>{fd.length}</strong> registros — {fmtCur(fd.reduce((s,o)=>s+(o.vrRepasse||0),0))}</div>
          <button onClick={()=>{exportXlsx(fd,'opsmanager-export');onClose()}} disabled={!fd.length} style={{background:C.accent2,color:'#fff',border:'none',borderRadius:8,padding:'10px 24px',fontWeight:700,fontSize:13,cursor:'pointer',opacity:fd.length?.1:.4}}>📤 Exportar XLSX</button>
        </div>
      </div>
    </div>
  </div>
}

/* ═══ PARCEIROS ═══ */
function Parceiros(){
  const[list,setList]=useState([]),[loading,setLoading]=useState(true),[showNew,setShowNew]=useState(false),[se,sSe]=useState('')
  const[nome,setNome]=useState(''),[cpf,setCpf]=useState(''),[tel,setTel]=useState(''),[email,setEmail]=useState(''),[cidade,setCidade]=useState(''),[uf,setUf]=useState(''),[resp,setResp]=useState(''),[obs,setObs]=useState(''),[msg,setMsg]=useState('')
  const fr=useRef(null)
  useEffect(()=>{supabase.from('parceiros').select('*').order('nome').then(({data})=>{setList(data||[]);setLoading(false)})},[])
  const reload=async()=>{const{data}=await supabase.from('parceiros').select('*').order('nome');setList(data||[])}
  const fd=list.filter(p=>{if(!se)return true;const s=se.toLowerCase();return(p.nome||'').toLowerCase().includes(s)||(p.cpf_cnpj||'').includes(s)||(p.cidade||'').toLowerCase().includes(s)})
  return<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
      <h2 style={{fontWeight:800,fontSize:20}}>Parceiros ({list.length})</h2>
      <div style={{display:'flex',gap:6}}>
        <button onClick={()=>fr.current?.click()} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:8,color:C.text,padding:'6px 14px',cursor:'pointer',fontWeight:600,fontSize:11}}>📥 Importar</button>
        <input ref={fr} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;const rd=new FileReader();rd.onload=async ev=>{const wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});for(let i=0;i<rows.length;i+=500){const batch=rows.slice(i,i+500).map(r=>({nome:String(r.Nome||r.nome||r.NOME||'').trim(),cpf_cnpj:String(r.CPF||r.CNPJ||r.cpf_cnpj||r['CPF/CNPJ']||'').trim(),telefone:String(r.Telefone||r.telefone||r.Tel||r.tel||'').trim(),email:String(r.Email||r.email||r.EMAIL||'').trim(),cidade:String(r.Cidade||r.cidade||'').trim(),uf:String(r.UF||r.uf||r.Estado||'').trim(),responsavel:String(r.Responsavel||r.responsavel||'').trim(),observacao:String(r.Obs||r.obs||r.Observação||'').trim()})).filter(r=>r.nome);await supabase.from('parceiros').upsert(batch,{onConflict:'nome',ignoreDuplicates:false})}await reload();setMsg(rows.length+' importados!')};rd.readAsArrayBuffer(file)}}/>
        <button onClick={()=>setShowNew(!showNew)} style={{background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'6px 14px',fontWeight:600,fontSize:11,cursor:'pointer'}}>+ Novo</button>
      </div>
    </div>
    {msg&&<div style={{background:C.accent2+'22',color:C.accent2,padding:'8px 12px',borderRadius:8,fontSize:12}}>{msg}</div>}
    {showNew&&<form onSubmit={async e=>{e.preventDefault();await supabase.from('parceiros').insert({nome,cpf_cnpj:cpf,telefone:tel,email,cidade,uf,responsavel:resp,observacao:obs});setNome('');setCpf('');setTel('');setEmail('');setCidade('');setUf('');setResp('');setObs('');setShowNew(false);await reload()}} style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16,display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,alignItems:'end'}}>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>NOME</label><input value={nome} onChange={e=>setNome(e.target.value)} required style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 10px',fontSize:12,width:'100%',boxSizing:'border-box'}}/></div>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>CPF/CNPJ</label><input value={cpf} onChange={e=>setCpf(e.target.value)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 10px',fontSize:12,width:'100%',boxSizing:'border-box'}}/></div>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>TELEFONE</label><input value={tel} onChange={e=>setTel(e.target.value)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 10px',fontSize:12,width:'100%',boxSizing:'border-box'}}/></div>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>EMAIL</label><input value={email} onChange={e=>setEmail(e.target.value)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 10px',fontSize:12,width:'100%',boxSizing:'border-box'}}/></div>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>CIDADE</label><input value={cidade} onChange={e=>setCidade(e.target.value)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 10px',fontSize:12,width:'100%',boxSizing:'border-box'}}/></div>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>UF</label><input value={uf} onChange={e=>setUf(e.target.value)} maxLength={2} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 10px',fontSize:12,width:'100%',boxSizing:'border-box'}}/></div>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:2}}>RESPONSÁVEL</label><input value={resp} onChange={e=>setResp(e.target.value)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 10px',fontSize:12,width:'100%',boxSizing:'border-box'}}/></div>
      <button type="submit" style={{background:C.accent2,color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontWeight:600,cursor:'pointer'}}>Salvar</button>
    </form>}
    <input value={se} onChange={e=>sSe(e.target.value)} placeholder="Buscar parceiro..." style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 12px',fontSize:12,outline:'none'}}/>
    {!loading&&<div style={{overflowX:'auto',borderRadius:10,border:'1px solid '+C.border}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr style={{background:C.surface}}>{['Nome','CPF/CNPJ','Telefone','Email','Cidade','UF','Status','Ações'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',color:C.muted,fontSize:8,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{fd.map(p=><tr key={p.id} style={{borderBottom:'1px solid '+C.border}}><td style={{padding:'8px 10px',fontWeight:600}}>{p.nome}</td><td style={{padding:'8px 10px'}}>{p.cpf_cnpj}</td><td style={{padding:'8px 10px'}}>{p.telefone}</td><td style={{padding:'8px 10px'}}>{p.email}</td><td style={{padding:'8px 10px'}}>{p.cidade}</td><td style={{padding:'8px 10px'}}>{p.uf}</td><td style={{padding:'8px 10px'}}><Badge text={p.ativo?'Ativo':'Inativo'} color={p.ativo?C.accent2:C.danger}/></td><td style={{padding:'8px 10px'}}><button onClick={async()=>{await supabase.from('parceiros').update({ativo:!p.ativo}).eq('id',p.id);await reload()}} style={{background:p.ativo?'#EF444418':C.accent2+'22',color:p.ativo?C.danger:C.accent2,border:'none',borderRadius:6,padding:'3px 8px',fontSize:10,fontWeight:600,cursor:'pointer'}}>{p.ativo?'Desativar':'Ativar'}</button></td></tr>)}</tbody></table></div>}
  </div>
}

/* ═══ HOOK: useOps with custom date support ═══ */
function useOps(defaultPer){
  const[per,setPer]=useState(defaultPer||'mes'),[ops,setOps]=useState([]),[loading,setLoading]=useState(false),[count,setCount]=useState(0)
  const[customDf,setCustomDf]=useState(''),[customDt,setCustomDt]=useState(''),[trigger,setTrigger]=useState(0)
  useEffect(()=>{let c=false;setLoading(true);fetchOps(per,n=>{if(!c)setCount(n)},customDf,customDt).then(d=>{if(!c){setOps(d);setCount(d.length)}}).catch(()=>{}).finally(()=>{if(!c)setLoading(false)});return()=>{c=true}},[per,trigger])
  const applyCustom=()=>setTrigger(t=>t+1)
  return{per,setPer,ops,loading,count,customDf,setCustomDf,customDt,setCustomDt,applyCustom}
}

/* ═══ IMPORT MODAL ═══ */
const IMP={id_ext:{l:'ID',a:['id']},banco:{l:'Banco',a:['banco']},cpf:{l:'CPF',a:['cpf']},cliente:{l:'Cliente',a:['cliente','nome']},proposta:{l:'Proposta',a:['proposta']},contrato:{l:'Contrato',a:['contrato','nº contrato']},data:{l:'Data',a:['data']},prazo:{l:'Prazo',a:['prazo']},vrBruto:{l:'Bruto',a:['vr. bruto','bruto']},vrParcela:{l:'Parcela',a:['vr. parcela']},vrLiquido:{l:'Líquido',a:['vr. líquido','vr liquido']},vrRepasse:{l:'Repasse',a:['vr. repasse','repasse']},vrSeguro:{l:'Seguro',a:['vr. seguro']},taxa:{l:'Taxa',a:['taxa']},operacao:{l:'Operação',a:['operação','operacao']},situacao:{l:'Situação',a:['situação','situacao','status']},produto:{l:'Produto',a:['produto']},convenio:{l:'Convênio',a:['convênio','convenio']},agente:{l:'Agente',a:['agente']},situacaoBanco:{l:'Sit.Banco',a:['situação banco','sit. banco']},obsSituacao:{l:'Obs.',a:['obs. situação','obs. situação banco','obs situação banco']},usuario:{l:'Usuário',a:['usuário','usuario']},crcCliente:{l:'CRC',a:['cr cliente','crc cliente','crc','data crc']},dataNossoCredito:{l:'N.Crédito',a:['nosso cr','nosso crédito','nosso credito']}}

function ImportModal({open,onClose,onImport}){
  const fr=useRef(null),[step,setStep]=useState(1),[raw,setRaw]=useState([]),[hd,setHd]=useState([]),[mp,setMp]=useState({}),[pv,setPv]=useState([]),[fn,setFn]=useState(''),[busy,setBusy]=useState(false),[progress,setProg]=useState('')
  useEffect(()=>{if(!open){setStep(1);setRaw([]);setHd([]);setMp({});setPv([]);setFn('');setBusy(false);setProg('')}},[open])
  if(!open)return null
  const vc=pv.filter(p=>p._v).length,tR=pv.filter(p=>p._v).reduce((s,o)=>s+(o.vrRepasse||0),0)
  return(
    <div style={{position:'fixed',inset:0,background:'#000c',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:'1px solid '+C.border,borderRadius:18,width:760,maxWidth:'97vw',maxHeight:'92vh',overflowY:'auto'}}>
        <div style={{padding:'16px 22px',borderBottom:'1px solid '+C.border,display:'flex',justifyContent:'space-between'}}><h3 style={{fontWeight:700,fontSize:15,margin:0}}>Importar — Etapa {step}/3</h3><button onClick={onClose} style={{background:'none',border:'none',color:C.muted,fontSize:22,cursor:'pointer'}}>×</button></div>
        <div style={{padding:'16px 22px'}}>
          {step===1&&<div onClick={()=>fr.current?.click()} style={{border:'2px dashed '+C.border,borderRadius:14,padding:'36px 20px',textAlign:'center',cursor:'pointer',background:C.surface}}><div style={{fontSize:32}}>📂</div><div style={{fontSize:13,fontWeight:600,marginTop:8}}>Clique para selecionar</div><input ref={fr} type="file" accept=".xlsx,.xls,.csv" onChange={e=>{const file=e.target.files?.[0];if(!file)return;setFn(file.name);const rd=new FileReader();rd.onload=ev=>{try{const wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});if(!rows.length)return;setRaw(rows);const cols=Object.keys(rows[0]);setHd(cols);const m={};Object.entries(IMP).forEach(([f,def])=>{const found=cols.find(c=>def.a.some(a=>c.toLowerCase().includes(a)));if(found)m[f]=found});setMp(m);setStep(2)}catch(ex){alert(ex.message)}};rd.readAsArrayBuffer(file)}} style={{display:'none'}}/></div>}
          {step===2&&<div style={{display:'flex',flexDirection:'column',gap:10}}><div style={{fontSize:12,color:C.muted}}>{fn} — {raw.length} linhas — {Object.keys(mp).length} detectados</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>{Object.entries(IMP).map(([f,def])=><div key={f}><label style={{fontSize:8,color:mp[f]?C.accent:C.muted,fontWeight:600}}>{def.l}</label><select value={mp[f]||''} onChange={e=>setMp(p=>({...p,[f]:e.target.value||undefined}))} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:6,color:C.text,padding:4,fontSize:10,width:'100%'}}><option value="">—</option>{hd.map(h=><option key={h} value={h}>{h}</option>)}</select></div>)}</div><div style={{display:'flex',gap:8}}><button onClick={()=>setStep(1)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:8,color:C.text,padding:'8px 16px',cursor:'pointer'}}>←</button><button onClick={()=>{const built=raw.map(row=>{const cl=mp.cliente?String(row[mp.cliente]||'').trim():'';const pr=mp.proposta?String(row[mp.proposta]||'').trim():'';const ok=!!(cl||pr);const g=f=>mp[f]?String(row[mp[f]]||'').trim():'';const gu=f=>g(f).toUpperCase();return{_v:ok,cliente:cl,proposta:pr,id_ext:g('id_ext'),banco:g('banco'),cpf:g('cpf'),contrato:g('contrato'),data:nDate(mp.data?row[mp.data]:''),prazo:g('prazo'),vrBruto:pNum(mp.vrBruto?row[mp.vrBruto]:''),vrParcela:pNum(mp.vrParcela?row[mp.vrParcela]:''),vrLiquido:pNum(mp.vrLiquido?row[mp.vrLiquido]:''),vrRepasse:pNum(mp.vrRepasse?row[mp.vrRepasse]:''),vrSeguro:pNum(mp.vrSeguro?row[mp.vrSeguro]:''),taxa:g('taxa'),operacao:gu('operacao'),situacao:gu('situacao'),produto:g('produto'),convenio:gu('convenio'),agente:g('agente'),situacaoBanco:gu('situacaoBanco'),obsSituacao:g('obsSituacao'),usuario:g('usuario'),crcCliente:nDate(mp.crcCliente?row[mp.crcCliente]:''),dataNossoCredito:nDate(mp.dataNossoCredito?row[mp.dataNossoCredito]:'')}});setPv(built);setStep(3)}} style={{flex:1,background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontWeight:600,cursor:'pointer'}}>Revisar →</button></div></div>}
          {step===3&&<div style={{display:'flex',flexDirection:'column',gap:10}}><div style={{fontSize:12}}><strong style={{color:C.accent2}}>{vc}</strong> válidas — {fmtCur(tR)}</div>{progress&&<div style={{fontSize:11,color:C.warn}}>{progress}</div>}<div style={{overflowX:'auto',maxHeight:260,borderRadius:8,border:'1px solid '+C.border}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}><thead><tr style={{background:C.surface}}>{['','Cliente','Banco','Sit.','Agente','Repasse'].map(h=><th key={h} style={{padding:'5px 7px',textAlign:'left',color:C.muted,fontSize:8}}>{h}</th>)}</tr></thead><tbody>{pv.slice(0,40).map((p,i)=><tr key={i} style={{borderBottom:'1px solid '+C.border,opacity:p._v?1:.3}}><td style={{padding:'3px 7px',color:p._v?C.accent2:C.danger}}>{p._v?'✓':'✕'}</td><td style={{padding:'3px 7px'}}>{p.cliente}</td><td style={{padding:'3px 7px'}}>{p.banco}</td><td style={{padding:'3px 7px'}}>{p.situacao}</td><td style={{padding:'3px 7px'}}>{p.agente}</td><td style={{padding:'3px 7px',fontWeight:600}}>{fmtCur(p.vrRepasse)}</td></tr>)}</tbody></table></div><div style={{display:'flex',gap:8}}><button onClick={()=>setStep(2)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:8,color:C.text,padding:'8px 16px',cursor:'pointer'}}>←</button><button onClick={async()=>{setBusy(true);const valid=pv.filter(p=>p._v).map(({_v,...r})=>r);const total=valid.length;for(let i=0;i<total;i+=500){setProg(`Gravando ${Math.min(i+500,total)}/${total}...`);await onImport(valid.slice(i,i+500))}setBusy(false);setProg('');onClose()}} disabled={!vc||busy} style={{flex:1,background:C.accent2,color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontWeight:600,cursor:'pointer',opacity:(!vc||busy)?.4:1}}>{busy?progress||'Gravando...':'✓ Importar '+vc}</button></div></div>}
        </div>
      </div>
    </div>
  )
}

/* ═══ PARTNER HEALTH MODAL ═══ */
function PartnerHealth({name,ops,onClose}){
  if(!name)return null
  const al=ops.filter(o=>o.agente===name)
  const fin=al.filter(isFin),est=al.filter(isEst),pend=al.filter(isPend)
  const r=al.reduce((s,o)=>s+(o.vrRepasse||0),0),fR=fin.reduce((s,o)=>s+(o.vrRepasse||0),0),eR=est.reduce((s,o)=>s+(o.vrRepasse||0),0)
  const cv=al.length?(fin.length/al.length*100):0,estP=al.length?(est.length/al.length*100):0
  const bB={};al.forEach(o=>{const k=o.banco||'?';if(!bB[k])bB[k]={c:0,r:0,f:0};bB[k].c++;bB[k].r+=(o.vrRepasse||0);if(isFin(o))bB[k].f++})
  const bO={};al.forEach(o=>{const k=o.operacao||'?';if(!bO[k])bO[k]={c:0,r:0,f:0};bO[k].c++;bO[k].r+=(o.vrRepasse||0);if(isFin(o))bO[k].f++})
  const bS={};al.forEach(o=>{const k=o.situacao||'?';if(!bS[k])bS[k]={c:0,r:0};bS[k].c++;bS[k].r+=(o.vrRepasse||0)})
  const health=cv>=60?'🟢 Excelente':cv>=40?'🟡 Bom':cv>=25?'🟠 Regular':'🔴 Crítico'
  const hColor=cv>=60?C.accent2:cv>=40?C.warn:cv>=25?'#F97316':C.danger
  return(
    <div style={{position:'fixed',inset:0,background:'#000c',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:'1px solid '+C.border,borderRadius:18,width:800,maxWidth:'97vw',maxHeight:'92vh',overflowY:'auto'}}>
        <div style={{padding:'16px 22px',borderBottom:'1px solid '+C.border,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div><h3 style={{fontWeight:700,fontSize:17,margin:0}}>{name}</h3><div style={{fontSize:12,color:hColor,fontWeight:700,marginTop:2}}>{health} — Conversão {cv.toFixed(0)}%</div></div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}><ExportBtn ops={al} name={'parceiro-'+name}/><button onClick={onClose} style={{background:'none',border:'none',color:C.muted,fontSize:22,cursor:'pointer'}}>×</button></div>
        </div>
        <div style={{padding:'16px 22px',display:'flex',flexDirection:'column',gap:14}}>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <Stat label="Total" value={al.length} small/><Stat label="Repasse" value={fmtCur(r)} color={C.accent} small/>
            <Stat label="Pagas" value={fin.length} sub={fmtCur(fR)} color={C.accent2} small/>
            <Stat label="Em Andamento" value={pend.length} sub={fmtCur(pend.reduce((s,o)=>s+(o.vrRepasse||0),0))} color={C.warn} small/>
            <Stat label="Estornos" value={est.length} sub={estP.toFixed(0)+'%'} color={C.danger} small/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
            <div style={{background:C.surface,border:'1px solid '+C.border,borderRadius:12,padding:14}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Por Banco</div>
              {Object.entries(bB).sort((a,b)=>b[1].r-a[1].r).map(([b,d])=><div key={b} style={{display:'flex',justifyContent:'space-between',fontSize:10,padding:'2px 0'}}><span>{b} ({d.c})</span><span style={{color:C.accent,fontWeight:600}}>{fmtCur(d.r)}</span></div>)}
            </div>
            <div style={{background:C.surface,border:'1px solid '+C.border,borderRadius:12,padding:14}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Por Operação</div>
              {Object.entries(bO).sort((a,b)=>b[1].r-a[1].r).map(([o,d])=><div key={o} style={{display:'flex',justifyContent:'space-between',fontSize:10,padding:'2px 0'}}><span>{o} ({d.c})</span><span style={{color:C.accent,fontWeight:600}}>{fmtCur(d.r)}</span></div>)}
            </div>
            <div style={{background:C.surface,border:'1px solid '+C.border,borderRadius:12,padding:14}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Por Situação</div>
              {Object.entries(bS).sort((a,b)=>b[1].c-a[1].c).map(([s,d])=><div key={s} style={{display:'flex',justifyContent:'space-between',fontSize:10,padding:'2px 0'}}><Badge text={s} color={sitCol(s)}/><span style={{fontWeight:600}}>{d.c} · {fmtCur(d.r)}</span></div>)}
            </div>
          </div>
          <div style={{background:C.surface,border:'1px solid '+C.accent+'33',borderRadius:12,padding:14}}>
            <div style={{fontSize:12,fontWeight:700,color:C.accent,marginBottom:6}}>📌 Diagnóstico</div>
            <div style={{fontSize:11,display:'flex',flexDirection:'column',gap:4}}>
              {cv>=60&&<div style={{color:C.accent2}}>✓ Alta conversão — parceiro estratégico</div>}
              {cv>=40&&cv<60&&<div style={{color:C.warn}}>⚠ Conversão mediana — acompanhar</div>}
              {cv<40&&al.length>5&&<div style={{color:C.danger}}>🔴 Conversão baixa ({cv.toFixed(0)}%) — AÇÃO URGENTE</div>}
              {estP>25&&<div style={{color:C.danger}}>🔴 {est.length} estornos ({estP.toFixed(0)}%) — investigar</div>}
              {estP<=10&&al.length>5&&<div style={{color:C.accent2}}>✓ Baixo estorno ({estP.toFixed(0)}%)</div>}
              {pend.length>0&&<div style={{color:C.info}}>📋 {pend.length} propostas em andamento ({fmtCur(pend.reduce((s,o)=>s+(o.vrRepasse||0),0))})</div>}
              {Object.entries(bB).length>0&&<div>🏦 Principal: <strong>{Object.entries(bB).sort((a,b)=>b[1].r-a[1].r)[0][0]}</strong></div>}
              {Object.entries(bO).length>0&&<div>⚡ Foco: <strong>{Object.entries(bO).sort((a,b)=>b[1].r-a[1].r)[0][0]}</strong></div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══ DASHBOARD ═══ */
function Dashboard({curOps,prevOps,curProd,prevProd,prevProdProp,m2Prop,m3Prop}){
  const{per,setPer,ops,loading,count,customDf,setCustomDf,customDt,setCustomDt,applyCustom}=useOps('mes')
  const f=ops,tR=f.reduce((s,o)=>s+(o.vrRepasse||0),0)
  const fin=f.filter(isFin),fR=fin.reduce((s,o)=>s+(o.vrRepasse||0),0)
  const est=f.filter(isEst),pend=f.filter(isPend)
  const ags=[...new Set(f.map(o=>o.agente).filter(Boolean))]
  const bySit={};f.forEach(o=>{const k=o.situacao||'?';if(!bySit[k])bySit[k]={c:0,r:0};bySit[k].c++;bySit[k].r+=(o.vrRepasse||0)})
  const sitArr=Object.entries(bySit).sort((a,b)=>b[1].c-a[1].c)
  const topM={};f.forEach(o=>{const a=o.agente||'?';if(!topM[a])topM[a]={r:0,c:0,fc:0,fr:0};topM[a].r+=(o.vrRepasse||0);topM[a].c++;if(isFin(o)){topM[a].fc++;topM[a].fr+=(o.vrRepasse||0)}})
  const topP=Object.entries(topM).sort((a,b)=>b[1].fr-a[1].fr).slice(0,10)
  // PRODUÇÃO = by CRC date
  const curProdR=curProd.reduce((s,o)=>s+(o.vrRepasse||0),0),prevProdR=prevProd.reduce((s,o)=>s+(o.vrRepasse||0),0)
  const prevPropR=(prevProdProp||[]).reduce((s,o)=>s+(o.vrRepasse||0),0)
  const m2PropR=(m2Prop||[]).reduce((s,o)=>s+(o.vrRepasse||0),0)
  const m3PropR=(m3Prop||[]).reduce((s,o)=>s+(o.vrRepasse||0),0)
  const varProp=prevPropR?((curProdR-prevPropR)/prevPropR*100):(curProdR>0?100:0)
  const varM2=m2PropR?((curProdR-m2PropR)/m2PropR*100):(curProdR>0?100:0)
  const varM3=m3PropR?((curProdR-m3PropR)/m3PropR*100):(curProdR>0?100:0)
  const DAY=NOW.getDate()
  const curDig=curOps.length,prevDig=prevOps.length,varDig=prevDig?((curDig-prevDig)/prevDig*100):(curDig>0?100:0)
  // Projeção by CRC
  const proj=getProj(curProd),pctDU=proj.duT?(proj.duP/proj.duT*100):0
  // Por banco — PRODUÇÃO (finalizados)
  const byBanco={};curProd.forEach(o=>{const k=o.banco||'?';if(!byBanco[k])byBanco[k]={c:0,r:0};byBanco[k].c++;byBanco[k].r+=(o.vrRepasse||0)})
  const bancoArr=Object.entries(byBanco).sort((a,b)=>b[1].r-a[1].r).slice(0,10)
  const[selP,setSelP]=useState(null)
  const vc=(v)=>v>0?'+'+v.toFixed(0)+'%':v.toFixed(0)+'%'
  const vCol=(v)=>v>0?C.accent2:v<-10?C.danger:C.warn
  // Nomes dos meses para comparativo
  const mName=(back)=>{const d=new Date(NOW.getFullYear(),NOW.getMonth()-back,1);return d.toLocaleDateString('pt-BR',{month:'short'}).replace('.','').toUpperCase()}
  // HOJE + ONTEM
  const TODAY_STR=NOW.toISOString().split('T')[0]
  const YESTERDAY=(()=>{const d=new Date(NOW);d.setDate(d.getDate()-1);return d.toISOString().split('T')[0]})()
  const ANTEONTEM=(()=>{const d=new Date(NOW);d.setDate(d.getDate()-2);return d.toISOString().split('T')[0]})()
  const tOps=curOps.filter(o=>o.data===TODAY_STR),yOps=curOps.filter(o=>o.data===YESTERDAY),aaOps=curOps.filter(o=>o.data===ANTEONTEM)
  const tR2=tOps.reduce((s,o)=>s+(o.vrRepasse||0),0),yR=yOps.reduce((s,o)=>s+(o.vrRepasse||0),0),aaR=aaOps.reduce((s,o)=>s+(o.vrRepasse||0),0)
  const yFin=yOps.filter(isFin),yEst=yOps.filter(isEst)
  const yAgs={};yOps.forEach(o=>{const a=o.agente||'?';if(!yAgs[a])yAgs[a]={c:0,r:0};yAgs[a].c++;yAgs[a].r+=(o.vrRepasse||0)})
  const yTopP=Object.entries(yAgs).sort((a,b)=>b[1].r-a[1].r).slice(0,5)
  const yBancos={};yOps.forEach(o=>{const b=o.banco||'?';if(!yBancos[b])yBancos[b]={c:0,r:0};yBancos[b].c++;yBancos[b].r+=(o.vrRepasse||0)})
  const yTopB=Object.entries(yBancos).sort((a,b)=>b[1].r-a[1].r).slice(0,5)
  // Prod by situação
  const prodBySit={};curProd.forEach(o=>{const k=o.situacao||'?';if(!prodBySit[k])prodBySit[k]={c:0,r:0};prodBySit[k].c++;prodBySit[k].r+=(o.vrRepasse||0)})

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <h2 style={{fontWeight:800,fontSize:20}}>Dashboard</h2>
      <PeriodBar per={per} setPer={setPer} loading={loading} customDf={customDf} customDt={customDt} setCustomDf={setCustomDf} setCustomDt={setCustomDt} onApplyCustom={applyCustom}/>
      <div style={{fontSize:10,color:C.muted}}>{count} digitações no período</div>

      {/* HOJE + ONTEM */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <div style={{background:C.card,border:'1px solid '+C.accent2+'44',borderRadius:14,padding:16}}>
          <div style={{fontSize:13,fontWeight:700,color:C.accent2,marginBottom:10}}>🟢 Hoje — {fmtDate(TODAY_STR)}</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
            <div><div style={{fontSize:8,color:C.muted,fontWeight:600}}>DIGITADAS</div><div style={{fontSize:18,fontWeight:700,color:C.accent}}>{tOps.length}</div></div>
            <div><div style={{fontSize:8,color:C.muted,fontWeight:600}}>REPASSE</div><div style={{fontSize:18,fontWeight:700,color:C.accent}}>{fmtCur(tR2)}</div></div>
            <div><div style={{fontSize:8,color:C.muted,fontWeight:600}}>PARCEIROS</div><div style={{fontSize:18,fontWeight:700}}>{[...new Set(tOps.map(o=>o.agente).filter(Boolean))].length}</div></div>
          </div>
        </div>
        <div style={{background:C.card,border:'1px solid '+C.info+'44',borderRadius:14,padding:16}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
            <span style={{fontSize:13,fontWeight:700,color:C.info}}>📋 Ontem — {fmtDate(YESTERDAY)}</span>
            <span style={{fontSize:9,color:C.muted}}>anteontem: {aaOps.length} · {fmtCur(aaR)}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
            <div><div style={{fontSize:8,color:C.muted,fontWeight:600}}>DIGITADAS</div><div style={{fontSize:18,fontWeight:700}}>{yOps.length}</div><div style={{fontSize:9,color:yOps.length>=aaOps.length?C.accent2:C.danger}}>{yOps.length>=aaOps.length?'↑':'↓'} vs {aaOps.length}</div></div>
            <div><div style={{fontSize:8,color:C.muted,fontWeight:600}}>REPASSE</div><div style={{fontSize:18,fontWeight:700}}>{fmtCur(yR)}</div></div>
            <div><div style={{fontSize:8,color:C.muted,fontWeight:600}}>FINALIZADAS</div><div style={{fontSize:18,fontWeight:700,color:C.accent2}}>{yFin.length}</div></div>
          </div>
        </div>
      </div>

      {/* DETALHAMENTO ONTEM */}
      {yOps.length>0&&<div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}>
        <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Detalhamento Ontem</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div><div style={{fontSize:10,fontWeight:600,color:C.muted,marginBottom:4}}>Top Parceiros</div>{yTopP.map(([a,d],i)=><div key={a} style={{display:'flex',justifyContent:'space-between',fontSize:10,padding:'2px 0'}}><span style={{color:i<3?C.accent:C.text}}>{i+1}. {a} ({d.c})</span><span style={{fontWeight:600,color:C.accent2}}>{fmtCur(d.r)}</span></div>)}</div>
          <div><div style={{fontSize:10,fontWeight:600,color:C.muted,marginBottom:4}}>Bancos</div>{yTopB.map(([b,d])=><div key={b} style={{display:'flex',justifyContent:'space-between',fontSize:10,padding:'2px 0'}}><span>{b} ({d.c})</span><span style={{fontWeight:600,color:C.accent}}>{fmtCur(d.r)}</span></div>)}</div>
        </div>
      </div>}

      {/* COMPARATIVO PROPORCIONAL — até dia {DAY} — 3 meses */}
      <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}>
        <div style={{fontSize:12,fontWeight:700,marginBottom:4}}>📊 Produção até dia {DAY} — Comparativo</div>
        <div style={{fontSize:10,color:C.muted,marginBottom:12}}>CRC Cliente até o dia {DAY} de cada mês (dias úteis: {proj.duP}/{proj.duT})</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
          <div style={{background:C.surface,borderRadius:10,padding:12,textAlign:'center'}}><div style={{fontSize:8,color:C.accent,fontWeight:700}}>MÊS ATUAL</div><div style={{fontSize:18,fontWeight:700,color:C.accent2}}>{fmtCur(curProdR)}</div><div style={{fontSize:9,color:C.muted}}>{curProd.length} ops</div></div>
          <div style={{background:C.surface,borderRadius:10,padding:12,textAlign:'center'}}><div style={{fontSize:8,color:C.muted,fontWeight:600}}>{mName(1)} até dia {DAY}</div><div style={{fontSize:18,fontWeight:700}}>{fmtCur(prevPropR)}</div><div style={{fontSize:10,fontWeight:600,color:vCol(varProp)}}>{vc(varProp)}</div></div>
          <div style={{background:C.surface,borderRadius:10,padding:12,textAlign:'center'}}><div style={{fontSize:8,color:C.muted,fontWeight:600}}>{mName(2)} até dia {DAY}</div><div style={{fontSize:18,fontWeight:700}}>{fmtCur(m2PropR)}</div><div style={{fontSize:10,fontWeight:600,color:vCol(varM2)}}>{vc(varM2)}</div></div>
          <div style={{background:C.surface,borderRadius:10,padding:12,textAlign:'center'}}><div style={{fontSize:8,color:C.muted,fontWeight:600}}>{mName(3)} até dia {DAY}</div><div style={{fontSize:18,fontWeight:700}}>{fmtCur(m3PropR)}</div><div style={{fontSize:10,fontWeight:600,color:vCol(varM3)}}>{vc(varM3)}</div></div>
        </div>
        <div style={{marginTop:8,fontSize:9,color:C.muted}}>Total {mName(1)}: {fmtCur(prevProdR)} ({prevProd.length} ops) · Digitações mês: {curDig} ({vc(varDig)} vs ant.)</div>
        {Object.keys(prodBySit).length>0&&<div style={{marginTop:10,display:'flex',gap:8,flexWrap:'wrap'}}>{Object.entries(prodBySit).sort((a,b)=>b[1].r-a[1].r).map(([s,d])=><div key={s} style={{background:C.bg,borderRadius:8,padding:'6px 12px',border:'1px solid '+C.border}}><div style={{fontSize:8,color:C.accent2,fontWeight:600}}>{s}</div><div style={{fontSize:12,fontWeight:700}}>{fmtCur(d.r)}</div><div style={{fontSize:8,color:C.muted}}>{d.c} ops</div></div>)}</div>}
      </div>

      {/* PROJEÇÃO — com digitações */}
      <div style={{background:C.card,border:'1px solid '+C.accent+'44',borderRadius:14,padding:16}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><span style={{fontSize:13,fontWeight:700,color:C.accent}}>📅 Projeção Mês ({proj.duP}/{proj.duT} DU · Restam {proj.duR} DU)</span></div>
        <div style={{height:6,background:C.surface,borderRadius:4,marginBottom:12}}><div style={{height:'100%',background:'linear-gradient(90deg,'+C.accent+','+C.accent2+')',borderRadius:4,width:pctDU+'%'}}/></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:8}}>
          <div style={{textAlign:'center'}}><div style={{fontSize:8,color:C.muted,fontWeight:600}}>PRODUÇÃO</div><div style={{fontSize:14,fontWeight:700,color:C.accent2}}>{fmtCur(proj.fR)}</div><div style={{fontSize:9,color:C.muted}}>{proj.fC} pagas</div></div>
          <div style={{textAlign:'center'}}><div style={{fontSize:8,color:C.muted,fontWeight:600}}>PROJEÇÃO</div><div style={{fontSize:14,fontWeight:700,color:C.accent}}>{fmtCur(proj.pR)}</div><div style={{fontSize:9,color:C.muted}}>~{proj.pD} pagas</div></div>
          <div style={{textAlign:'center'}}><div style={{fontSize:8,color:C.muted,fontWeight:600}}>FALTA</div><div style={{fontSize:14,fontWeight:700,color:C.warn}}>{fmtCur(Math.max(0,proj.pR-proj.fR))}</div></div>
          <div style={{textAlign:'center'}}><div style={{fontSize:8,color:C.muted,fontWeight:600}}>MÉDIA/DU</div><div style={{fontSize:14,fontWeight:700}}>{fmtCur(proj.mdR)}</div></div>
          <div style={{textAlign:'center'}}><div style={{fontSize:8,color:C.muted,fontWeight:600}}>DIGITADAS</div><div style={{fontSize:14,fontWeight:700,color:C.info}}>{proj.dig}</div><div style={{fontSize:9,color:C.muted}}>{(proj.duP>0?(proj.dig/proj.duP):0).toFixed(1)}/DU</div></div>
          <div style={{textAlign:'center'}}><div style={{fontSize:8,color:C.muted,fontWeight:600}}>PROJ.DIG.</div><div style={{fontSize:14,fontWeight:700,color:C.info}}>{proj.duP>0?Math.round(proj.dig/proj.duP*proj.duT):0}</div></div>
        </div>
      </div>

      {/* CARDS PERÍODO */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <Stat label="Produção (Pago)" value={fmtCur(fR)} color={C.accent2} sub={fin.length+' finalizadas'}/>
        <Stat label="Digitações" value={f.length} sub={fmtCur(tR)+' digitado'}/>
        <Stat label="Em Andamento" value={pend.length} sub={fmtCur(pend.reduce((s,o)=>s+(o.vrRepasse||0),0))} color={C.warn}/>
        <Stat label="Estornos" value={est.length} sub={fmtCur(est.reduce((s,o)=>s+(o.vrRepasse||0),0))} color={C.danger}/>
        <Stat label="Parceiros" value={ags.length}/>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
        {/* SITUAÇÕES COM VALORES */}
        <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}>
          <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>Situações</div>
          {sitArr.slice(0,10).map(([s,d])=><div key={s} style={{marginBottom:5}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:10}}><span style={{color:sitCol(s),fontWeight:600}}>{s}</span><span style={{color:C.muted}}>{d.c} · {fmtCur(d.r)}</span></div>
            <div style={{height:4,background:C.surface,borderRadius:2}}><div style={{height:'100%',background:sitCol(s),borderRadius:2,width:(d.c/(f.length||1)*100)+'%'}}/></div>
          </div>)}
        </div>

        {/* TOP PARCEIROS — clicável */}
        <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}>
          <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>Top Parceiros <span style={{fontSize:9,color:C.muted}}>(clique p/ health)</span></div>
          {topP.map(([ag,d],i)=>{const cv=d.c?(d.fc/d.c*100):0;return<div key={ag} onClick={()=>setSelP(ag)} style={{display:'flex',alignItems:'center',gap:6,padding:'4px 0',borderBottom:'1px solid '+C.border,cursor:'pointer'}}>
            <span style={{fontSize:10,fontWeight:700,color:i<3?C.accent:C.muted,width:16}}>{i+1}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ag}</div>
              <div style={{fontSize:8,color:C.muted}}>{d.c} dig · {d.fc} prod · {cv.toFixed(0)}%</div>
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <div style={{fontSize:10,fontWeight:700,color:C.accent2}}>{fmtCur(d.fr)}</div>
              <div style={{fontSize:8,color:C.muted}}>dig: {fmtCur(d.r)}</div>
            </div>
          </div>})}
        </div>

        {/* POR BANCO — PRODUÇÃO */}
        <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}>
          <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>Produção por Banco (CRC mês)</div>
          {bancoArr.map(([b,d])=>{const mx=bancoArr[0]?.[1]?.r||1;return<div key={b} style={{marginBottom:5}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:10}}><span style={{fontWeight:600}}>{b}</span><span style={{color:C.accent2,fontWeight:600}}>{fmtCur(d.r)} <span style={{color:C.muted}}>({d.c} ops)</span></span></div>
            <div style={{height:4,background:C.surface,borderRadius:2}}><div style={{height:'100%',background:C.accent2,borderRadius:2,width:(d.r/mx*100)+'%'}}/></div>
          </div>})}
        </div>
      </div>
      <PartnerHealth name={selP} ops={ops} onClose={()=>setSelP(null)}/>
    </div>
  )
}

/* ═══ OPERAÇÕES ═══ */
function Operacoes({onImport}){
  const{per,setPer,ops,loading,count,customDf,setCustomDf,customDt,setCustomDt,applyCustom}=useOps('mes')
  const[io,sio]=useState(false),[se,sse]=useState(''),[fs,sfs]=useState(''),[selP,setSelP]=useState(null),[showExp,setShowExp]=useState(false)
  const aS=[...new Set(ops.map(o=>o.situacao).filter(Boolean))].sort()
  const fd=ops.filter(o=>!fs||o.situacao===fs).filter(o=>{if(!se)return true;const s=se.toLowerCase();return(o.cliente||'').toLowerCase().includes(s)||(o.agente||'').toLowerCase().includes(s)||(o.cpf||'').includes(s)}).sort((a,b)=>(b.data||'').localeCompare(a.data||''))
  return(
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:8}}><h2 style={{fontWeight:800,fontSize:20}}>Operações</h2><div style={{display:'flex',gap:6}}><button onClick={()=>setShowExp(true)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:8,color:C.text,padding:'6px 14px',cursor:'pointer',fontWeight:600,fontSize:11}}>📤 Exportar</button><button onClick={()=>sio(true)} style={{background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:12}}>📥 Importar</button></div></div>
      <PeriodBar per={per} setPer={setPer} loading={loading} customDf={customDf} customDt={customDt} setCustomDf={setCustomDf} setCustomDt={setCustomDt} onApplyCustom={applyCustom}/>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}><input value={se} onChange={e=>sse(e.target.value)} placeholder="Buscar..." style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 12px',fontSize:12,outline:'none',flex:1,minWidth:160}}/><select value={fs} onChange={e=>sfs(e.target.value)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 11px',fontSize:12}}><option value="">— Situação —</option>{aS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
      <div style={{fontSize:10,color:C.muted}}>{fd.length} de {count} — {fmtCur(fd.reduce((s,o)=>s+(o.vrRepasse||0),0))}</div>
      <div style={{overflowX:'auto',borderRadius:10,border:'1px solid '+C.border}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr style={{background:C.surface}}>{['Data','Cliente','Banco','Op.','Situação','Agente','Repasse'].map(h=><th key={h} style={{padding:'8px 9px',textAlign:'left',color:C.muted,fontSize:8,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{fd.slice(0,500).map(o=><tr key={o.id} style={{borderBottom:'1px solid '+C.border}}><td style={{padding:'7px 9px',whiteSpace:'nowrap'}}>{fmtDate(o.data)}</td><td style={{padding:'7px 9px',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.cliente||'—'}</td><td style={{padding:'7px 9px'}}>{o.banco}</td><td style={{padding:'7px 9px'}}>{o.operacao}</td><td style={{padding:'7px 9px'}}><Badge text={o.situacao||'—'} color={sitCol(o.situacao)}/></td><td style={{padding:'7px 9px',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer',color:C.accent}} onClick={()=>setSelP(o.agente)}>{o.agente}</td><td style={{padding:'7px 9px',fontWeight:600}}>{fmtCur(o.vrRepasse)}</td></tr>)}</tbody></table></div>
      <ImportModal open={io} onClose={()=>sio(false)} onImport={onImport}/>
      <ExportModal open={showExp} onClose={()=>setShowExp(false)} ops={ops}/>
      <PartnerHealth name={selP} ops={ops} onClose={()=>setSelP(null)}/>
    </div>
  )
}

/* ═══ PRODUÇÃO — somente FINALIZADOS ═══ */
function Producao(){
  const{per,setPer,ops,loading,customDf,setCustomDf,customDt,setCustomDt,applyCustom}=useOps('mes')
  const[tab,sTab]=useState('banco')
  const fin=ops.filter(isFin)
  const totalDig=ops.length
  const totalProd=fin.reduce((s,o)=>s+(o.vrRepasse||0),0)
  const cv=totalDig?(fin.length/totalDig*100):0
  const kFn=tab==='banco'?o=>o.banco:tab==='convenio'?o=>o.convenio:o=>o.operacao
  // Agrupa FINALIZADOS por banco/convenio/operacao
  const m={};fin.forEach(o=>{const k=kFn(o)||'?';if(!m[k])m[k]={c:0,r:0};m[k].c++;m[k].r+=(o.vrRepasse||0)})
  // Conta digitações totais por grupo pra mostrar conversão
  const md={};ops.forEach(o=>{const k=kFn(o)||'?';md[k]=(md[k]||0)+1})
  const data=Object.entries(m).sort((a,b)=>b[1].r-a[1].r)
  const finOps=fin
  return<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <div style={{display:'flex',justifyContent:'space-between'}}><h2 style={{fontWeight:800,fontSize:20}}>Produção</h2><ExportBtn ops={finOps} name={'producao-'+per}/></div>
    <PeriodBar per={per} setPer={setPer} loading={loading} customDf={customDf} customDt={customDt} setCustomDf={setCustomDf} setCustomDt={setCustomDt} onApplyCustom={applyCustom}/>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <Stat label="Produção (Pago)" value={fmtCur(totalProd)} color={C.accent2} sub={fin.length+' finalizadas'}/>
      <Stat label="Digitadas" value={totalDig}/>
      <Stat label="Conversão" value={cv.toFixed(0)+'%'} color={cv>=50?C.accent2:cv>=30?C.warn:C.danger}/>
    </div>
    <div style={{display:'flex',gap:4}}>{[{id:'banco',n:'🏦 Banco'},{id:'convenio',n:'📑 Convênio'},{id:'operacao',n:'⚡ Operação'}].map(t=><button key={t.id} onClick={()=>sTab(t.id)} style={{padding:'6px 14px',borderRadius:8,border:'1px solid '+(tab===t.id?C.accent:C.border),background:tab===t.id?C.abg:'transparent',color:tab===t.id?C.accent:C.muted,fontSize:11,cursor:'pointer'}}>{t.n}</button>)}</div>
    <div style={{overflowX:'auto',borderRadius:10,border:'1px solid '+C.border}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
        <thead><tr style={{background:C.surface}}>{[tab==='banco'?'Banco':tab==='convenio'?'Convênio':'Operação','Produção (Pago)','%','Qtd Pagas','Digitadas','Conv.'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',color:C.muted,fontSize:8,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
        <tbody>{data.map(([n,d])=>{const pct=totalProd?(d.r/totalProd*100):0;const dig=md[n]||0;const cvn=dig?(d.c/dig*100):0;return<tr key={n} style={{borderBottom:'1px solid '+C.border}}>
          <td style={{padding:'8px 10px',fontWeight:700}}>{n}</td>
          <td style={{padding:'8px 10px',fontWeight:600,color:C.accent2}}>{fmtCur(d.r)}</td>
          <td style={{padding:'8px 10px',color:C.muted}}>{pct.toFixed(0)}%</td>
          <td style={{padding:'8px 10px',fontWeight:600}}>{d.c}</td>
          <td style={{padding:'8px 10px',color:C.muted}}>{dig}</td>
          <td style={{padding:'8px 10px',fontWeight:600,color:cvn>=50?C.accent2:cvn>=30?C.warn:C.danger}}>{cvn.toFixed(0)}%</td>
        </tr>})}</tbody>
      </table>
    </div>
  </div>
}

/* ═══ ESTRATÉGICO ═══ */
function Estrategico(){const{per,setPer,ops,loading,customDf,setCustomDf,customDt,setCustomDt,applyCustom}=useOps('tudo');const[sel,sSel]=useState(null),[selP,setSelP]=useState(null);const list=(()=>{const ags=[...new Set(ops.map(o=>o.agente).filter(Boolean))];return ags.map(a=>{const al=ops.filter(o=>o.agente===a),fn=al.filter(isFin),est=al.filter(isEst),r=al.reduce((s,o)=>s+(o.vrRepasse||0),0),cv=al.length?(fn.length/al.length*100):0,er=al.length?(est.length/al.length*100):0;return{name:a,c:al.length,r,fC:fn.length,cv,estC:est.length,er}}).sort((a,b)=>b.r-a.r)})();return<div style={{display:'flex',flexDirection:'column',gap:14}}><div style={{display:'flex',justifyContent:'space-between'}}><h2 style={{fontWeight:800,fontSize:20}}>Estratégico</h2><ExportBtn ops={ops} name={'estrategico-'+per}/></div><PeriodBar per={per} setPer={setPer} loading={loading} customDf={customDf} customDt={customDt} setCustomDf={setCustomDf} setCustomDt={setCustomDt} onApplyCustom={applyCustom}/><div style={{overflowX:'auto',borderRadius:10,border:'1px solid '+C.border}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr style={{background:C.surface}}>{['Parceiro','Dig.','Repasse','Conv.','Estornos','Health',''].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',color:C.muted,fontSize:8,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{list.map(p=>{const h=p.cv>=60?'🟢':p.cv>=40?'🟡':p.cv>=25?'🟠':'🔴';return<tr key={p.name} style={{borderBottom:'1px solid '+C.border,cursor:'pointer'}} onClick={()=>setSelP(p.name)}><td style={{padding:'8px 10px',fontWeight:600}}>{p.name}</td><td style={{padding:'8px 10px'}}>{p.c}</td><td style={{padding:'8px 10px',fontWeight:600,color:C.accent}}>{fmtCur(p.r)}</td><td style={{padding:'8px 10px',fontWeight:600,color:p.cv>=50?C.accent2:p.cv>=30?C.warn:C.danger}}>{p.cv.toFixed(0)}%</td><td style={{padding:'8px 10px',color:p.estC?C.danger:C.muted}}>{p.estC} ({p.er.toFixed(0)}%)</td><td style={{padding:'8px 10px',fontSize:14}}>{h}</td><td style={{color:C.accent}}>→</td></tr>})}</tbody></table></div><PartnerHealth name={selP} ops={ops} onClose={()=>setSelP(null)}/></div>}

/* ═══ RANKING ═══ */
function Ranking(){const{per,setPer,ops,loading,customDf,setCustomDf,customDt,setCustomDt,applyCustom}=useOps('mes');const[selP,setSelP]=useState(null);const data=(()=>{const ags=[...new Set(ops.map(o=>o.agente).filter(Boolean))];return ags.map(a=>{const al=ops.filter(o=>o.agente===a),fn=al.filter(isFin),est=al.filter(isEst),r=al.reduce((s,o)=>s+(o.vrRepasse||0),0),cv=al.length?(fn.length/al.length*100):0;return{name:a,c:al.length,r,cv,estC:est.length}}).sort((a,b)=>b.r-a.r)})();return<div style={{display:'flex',flexDirection:'column',gap:14}}><div style={{display:'flex',justifyContent:'space-between'}}><h2 style={{fontWeight:800,fontSize:20}}>Ranking</h2><ExportBtn ops={ops} name={'ranking-'+per}/></div><PeriodBar per={per} setPer={setPer} loading={loading} customDf={customDf} customDt={customDt} setCustomDf={setCustomDf} setCustomDt={setCustomDt} onApplyCustom={applyCustom}/><div style={{overflowX:'auto',borderRadius:10,border:'1px solid '+C.border}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr style={{background:C.surface}}>{['#','Parceiro','Dig.','Repasse','Conv.','Est.','Health'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',color:C.muted,fontSize:8,textTransform:'uppercase'}}>{h}</th>)}</tr></thead><tbody>{data.map((d,i)=>{const h=d.cv>=60?'🟢':d.cv>=40?'🟡':d.cv>=25?'🟠':'🔴';return<tr key={d.name} style={{borderBottom:'1px solid '+C.border,cursor:'pointer'}} onClick={()=>setSelP(d.name)}><td style={{padding:'8px 10px'}}><span style={{display:'inline-flex',width:22,height:22,borderRadius:6,background:i<3?C.accent:C.surface,alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:i<3?'#fff':C.muted}}>{i+1}</span></td><td style={{padding:'8px 10px',fontWeight:600}}>{d.name}</td><td style={{padding:'8px 10px'}}>{d.c}</td><td style={{padding:'8px 10px',fontWeight:600,color:C.accent}}>{fmtCur(d.r)}</td><td style={{padding:'8px 10px',fontWeight:600,color:d.cv>=50?C.accent2:d.cv>=30?C.warn:C.danger}}>{d.cv.toFixed(0)}%</td><td style={{padding:'8px 10px',color:d.estC?C.danger:C.muted}}>{d.estC}</td><td style={{fontSize:14}}>{h}</td></tr>})}</tbody></table></div><PartnerHealth name={selP} ops={ops} onClose={()=>setSelP(null)}/></div>}

/* ═══ RECEBIMENTOS ═══ */
function Recebimentos(){
  const[pend,setPend]=useState([]),[rec,setRec]=useState([]),[loading,setLoading]=useState(true)
  const[fB,sFB]=useState(''),[fA,sFA]=useState(''),[showExp,setShowExp]=useState(false),[fAging,sFAging]=useState('')

  useEffect(()=>{
    setLoading(true)
    fetchReceb().then(all=>{
      const comCrc=all.filter(o=>o.crcCliente&&o.crcCliente.length>=8)
      setPend(comCrc.filter(o=>!o.dataNossoCredito||o.dataNossoCredito.length<8))
      setRec(comCrc.filter(o=>o.dataNossoCredito&&o.dataNossoCredito.length>=8))
      setLoading(false)
    }).catch(e=>{console.error('Receb load error:',e);setLoading(false)})
  },[])

  const pR=pend.reduce((s,o)=>s+(o.vrRepasse||0),0)
  const byBanco=(()=>{const m={};pend.forEach(o=>{const b=o.banco||'?';if(!m[b])m[b]={c:0,r:0,ds:[]};m[b].c++;m[b].r+=(o.vrRepasse||0);if(o.crcCliente)m[b].ds.push(getBD(o.crcCliente))});return Object.entries(m).map(([b,d])=>({b,...d,md:d.ds.length?Math.round(d.ds.reduce((a,x)=>a+x,0)/d.ds.length):0,mx:d.ds.length?Math.max(...d.ds):0})).sort((a,b)=>b.r-a.r)})()
  const byOp=(()=>{const m={};pend.forEach(o=>{const k=o.operacao||'?';if(!m[k])m[k]={c:0,r:0};m[k].c++;m[k].r+=(o.vrRepasse||0)});return Object.entries(m).sort((a,b)=>b[1].r-a[1].r)})()
  const byAg2=(()=>{const m={};pend.forEach(o=>{const a=o.agente||'?';if(!m[a])m[a]={c:0,r:0,ds:[]};m[a].c++;m[a].r+=(o.vrRepasse||0);if(o.crcCliente)m[a].ds.push(getBD(o.crcCliente))});return Object.entries(m).map(([a,d])=>({a,c:d.c,r:d.r,md:d.ds.length?Math.round(d.ds.reduce((x,y)=>x+y,0)/d.ds.length):0})).sort((a,b)=>b.r-a.r)})()
  const AGING_KEYS=['0-5','5-10','10-15','15-30','30-60','60-90','90+']
  const aging=(()=>{const fx={};AGING_KEYS.forEach(k=>fx[k]=[0,0]);pend.forEach(o=>{if(!o.crcCliente)return;const bd=getBD(o.crcCliente),k=getAgingKey(bd);fx[k][0]++;fx[k][1]+=(o.vrRepasse||0)});return Object.entries(fx)})()
  const filt=pend.filter(o=>(!fB||o.banco===fB)&&(!fA||o.agente===fA)&&(!fAging||(o.crcCliente&&getAgingKey(getBD(o.crcCliente))===fAging)))

  return<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <h2 style={{fontWeight:800,fontSize:20}}>A Receber {loading?'⏳':''}</h2>
      <div style={{display:'flex',gap:6}}>
        <button onClick={()=>setShowExp(true)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:8,color:C.text,padding:'6px 14px',cursor:'pointer',fontWeight:600,fontSize:11}}>📤 Exportar</button>
        <ExportBtn ops={pend} name={'a-receber-todos'}/>
      </div>
    </div>
    <div style={{background:C.card,border:'1px solid '+C.warn+'44',borderRadius:12,padding:12,fontSize:11,color:C.warn}}>
      💡 Mostra <strong>todas</strong> as propostas onde o cliente já recebeu (CRC preenchido) mas você ainda não recebeu (Nosso Crédito vazio) — independente de período.
    </div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <Stat label="A Receber" value={pend.length} sub={fmtCur(pR)} color={C.danger}/>
      <Stat label="Já Recebido" value={rec.length} sub={fmtCur(rec.reduce((s,o)=>s+(o.vrRepasse||0),0))} color={C.accent2}/>
      <Stat label="Total CRC" value={pend.length+rec.length}/>
    </div>

    {pend.length>0&&<>
      {/* AGING — DIAS ÚTEIS — clicável para filtrar */}
      <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}>
        <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Aging — Dias Úteis desde CRC {fAging&&<button onClick={()=>sFAging('')} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:6,color:C.accent,padding:'2px 8px',fontSize:9,cursor:'pointer',marginLeft:8}}>✕ Limpar</button>}</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {aging.map(([k,[c,r]])=>{const col=k.includes('90')||k.includes('60')?C.danger:k.includes('30')?C.warn:k.includes('15')||k.includes('10')?C.info:C.accent2;const pct=pend.length?(c/pend.length*100):0;const active=fAging===k;return c>0?<div key={k} onClick={()=>sFAging(active?'':k)} style={{background:active?col+'22':C.surface,border:'1px solid '+(active?col:C.border),borderRadius:10,padding:'10px 16px',minWidth:90,cursor:'pointer'}}>
            <div style={{fontSize:18,fontWeight:700,color:col}}>{c}</div>
            <div style={{fontSize:10,fontWeight:600,color:col}}>{k} DU</div>
            <div style={{fontSize:9,color:C.muted}}>{fmtCur(r)}</div>
            <div style={{height:3,background:C.border,borderRadius:2,marginTop:4}}><div style={{height:'100%',background:col,borderRadius:2,width:pct+'%'}}/></div>
          </div>:null})}
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
        {/* POR BANCO */}
        <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}>
          <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Por Banco</div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr style={{background:C.surface}}>{['Banco','Qtd','A Receber','Média DU','Máx DU'].map(h=><th key={h} style={{padding:'6px 8px',textAlign:'left',color:C.muted,fontSize:8}}>{h}</th>)}</tr></thead>
          <tbody>{byBanco.map(b=><tr key={b.b} style={{borderBottom:'1px solid '+C.border}}>
            <td style={{padding:'6px 8px',fontWeight:700}}>{b.b}</td>
            <td style={{padding:'6px 8px'}}>{b.c}</td>
            <td style={{padding:'6px 8px',fontWeight:600,color:C.danger}}>{fmtCur(b.r)}</td>
            <td style={{padding:'6px 8px',color:b.md>60?C.danger:b.md>30?C.warn:C.text}}>{b.md}d</td>
            <td style={{padding:'6px 8px',color:b.mx>90?C.danger:C.warn,fontWeight:600}}>{b.mx}d</td>
          </tr>)}</tbody></table>
        </div>
        {/* POR OPERAÇÃO */}
        <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}>
          <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Por Operação</div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr style={{background:C.surface}}>{['Operação','Qtd','A Receber'].map(h=><th key={h} style={{padding:'6px 8px',textAlign:'left',color:C.muted,fontSize:8}}>{h}</th>)}</tr></thead>
          <tbody>{byOp.map(([op,d])=><tr key={op} style={{borderBottom:'1px solid '+C.border}}>
            <td style={{padding:'6px 8px',fontWeight:600}}>{op}</td>
            <td style={{padding:'6px 8px'}}>{d.c}</td>
            <td style={{padding:'6px 8px',fontWeight:600,color:C.danger}}>{fmtCur(d.r)}</td>
          </tr>)}</tbody></table>
        </div>
        {/* POR PARCEIRO */}
        <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}>
          <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Por Parceiro</div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr style={{background:C.surface}}>{['Parceiro','Qtd','A Receber','Média DU'].map(h=><th key={h} style={{padding:'6px 8px',textAlign:'left',color:C.muted,fontSize:8}}>{h}</th>)}</tr></thead>
          <tbody>{byAg2.slice(0,20).map(a=><tr key={a.a} style={{borderBottom:'1px solid '+C.border}}>
            <td style={{padding:'6px 8px',fontWeight:600,maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.a}</td>
            <td style={{padding:'6px 8px'}}>{a.c}</td>
            <td style={{padding:'6px 8px',fontWeight:600,color:C.danger}}>{fmtCur(a.r)}</td>
            <td style={{padding:'6px 8px',color:a.md>60?C.danger:a.md>30?C.warn:C.text}}>{a.md}d</td>
          </tr>)}</tbody></table>
        </div>
      </div>

      {/* BANCO × DIAS EM ABERTO */}
      <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}>
        <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Banco × Dias Úteis em Aberto</div>
        {(()=>{
          const FAIXAS=['0-5','5-10','10-15','15-30','30-60','60-90','90+']
          const getFaixa=d=>d<=5?'0-5':d<=10?'5-10':d<=15?'10-15':d<=30?'15-30':d<=60?'30-60':d<=90?'60-90':'90+'
          const mx={};pend.forEach(o=>{const b=o.banco||'?',d=o.crcCliente?getBD(o.crcCliente):0,f=getFaixa(d);if(!mx[b])mx[b]={};if(!mx[b][f])mx[b][f]={c:0,r:0};mx[b][f].c++;mx[b][f].r+=(o.vrRepasse||0)})
          const bancos=Object.keys(mx).sort()
          return<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
            <thead><tr style={{background:C.surface}}>
              <th style={{padding:'6px 8px',textAlign:'left',color:C.muted,fontSize:8,position:'sticky',left:0,background:C.surface}}>BANCO</th>
              {FAIXAS.map(f=><th key={f} style={{padding:'6px 8px',textAlign:'center',color:C.muted,fontSize:8,minWidth:70}}>{f} DU</th>)}
              <th style={{padding:'6px 8px',textAlign:'center',color:C.muted,fontSize:8,fontWeight:700}}>TOTAL</th>
            </tr></thead>
            <tbody>{bancos.map(b=>{
              const total={c:0,r:0};FAIXAS.forEach(f=>{if(mx[b]?.[f]){total.c+=mx[b][f].c;total.r+=mx[b][f].r}})
              return<tr key={b} style={{borderBottom:'1px solid '+C.border}}>
                <td style={{padding:'6px 8px',fontWeight:600,position:'sticky',left:0,background:C.card}}>{b}</td>
                {FAIXAS.map(f=>{const v=mx[b]?.[f];const col=f.includes('90')||f.includes('60')?C.danger:f.includes('30')?C.warn:f.includes('15')?C.info:C.accent2;return<td key={f} style={{padding:'6px 8px',textAlign:'center'}}>{v?<div><div style={{fontWeight:600,color:col}}>{v.c}</div><div style={{fontSize:8,color:C.muted}}>{fmtCur(v.r)}</div></div>:<span style={{color:C.border}}>—</span>}</td>})}
                <td style={{padding:'6px 8px',textAlign:'center',fontWeight:700}}><div style={{color:C.danger}}>{total.c}</div><div style={{fontSize:8,color:C.muted}}>{fmtCur(total.r)}</div></td>
              </tr>
            })}</tbody>
          </table></div>
        })()}
      </div>

      {/* ANALÍTICO */}
      <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:10,alignItems:'center',flexWrap:'wrap',gap:8}}>
          <span style={{fontSize:12,fontWeight:700}}>Analítico — {filt.length} pendências ({fmtCur(filt.reduce((s,o)=>s+(o.vrRepasse||0),0))})</span>
          <div style={{display:'flex',gap:6}}>
            <select value={fB} onChange={e=>sFB(e.target.value)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:6,color:C.text,padding:'4px 8px',fontSize:10}}>
              <option value="">— Banco —</option>
              {[...new Set(pend.map(o=>o.banco).filter(Boolean))].sort().map(b=><option key={b} value={b}>{b}</option>)}
            </select>
            <select value={fA} onChange={e=>sFA(e.target.value)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:6,color:C.text,padding:'4px 8px',fontSize:10}}>
              <option value="">— Parceiro —</option>
              {[...new Set(pend.map(o=>o.agente).filter(Boolean))].sort().map(a=><option key={a} value={a}>{a}</option>)}
            </select>
            <select value={fAging} onChange={e=>sFAging(e.target.value)} style={{background:C.surface,border:'1px solid '+(fAging?C.danger:C.border),borderRadius:6,color:fAging?C.danger:C.text,padding:'4px 8px',fontSize:10}}>
              <option value="">— Aging DU —</option>
              {AGING_KEYS.map(k=><option key={k} value={k}>{k} DU</option>)}
            </select>
            {(fB||fA||fAging)&&<button onClick={()=>{sFB('');sFA('');sFAging('')}} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:6,color:C.muted,padding:'4px 8px',fontSize:10,cursor:'pointer'}}>✕</button>}
            <ExportBtn ops={filt} name={'a-receber-filtrado'}/>
          </div>
        </div>
        <div style={{overflowX:'auto',maxHeight:400,borderRadius:8,border:'1px solid '+C.border}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
            <thead><tr style={{background:C.surface,position:'sticky',top:0}}>
              {['Cliente','CPF','Banco','Op.','Agente','Repasse','CRC Cliente','DU'].map(h=><th key={h} style={{padding:'6px 8px',textAlign:'left',color:C.muted,fontSize:8}}>{h}</th>)}
            </tr></thead>
            <tbody>{filt.slice(0,500).map(o=>{
              const dias=o.crcCliente?getBD(o.crcCliente):0
              return<tr key={o.id} style={{borderBottom:'1px solid '+C.border}}>
                <td style={{padding:'5px 8px',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.cliente}</td>
                <td style={{padding:'5px 8px'}}>{o.cpf}</td>
                <td style={{padding:'5px 8px'}}>{o.banco}</td>
                <td style={{padding:'5px 8px'}}>{o.operacao}</td>
                <td style={{padding:'5px 8px',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.agente}</td>
                <td style={{padding:'5px 8px',fontWeight:600,color:C.danger}}>{fmtCur(o.vrRepasse)}</td>
                <td style={{padding:'5px 8px'}}>{fmtDate(o.crcCliente)}</td>
                <td style={{padding:'5px 8px',fontWeight:600,color:dias>90?C.danger:dias>30?C.warn:C.text}}>{dias}d</td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </div>
    </>}
    <ExportModal open={showExp} onClose={()=>setShowExp(false)} ops={pend}/>
  </div>
}

/* ═══ ESTORNOS ═══ */
function Portabilidade(){
  const{per,setPer,ops,loading,customDf,setCustomDf,customDt,setCustomDt,applyCustom}=useOps('mes')
  const port=ops.filter(o=>(o.operacao||'').toUpperCase().includes('PORTAB'))
  const tD=port.length,tP=port.filter(isFin).length,cv=tD?(tP/tD*100):0
  const byBanco=(()=>{const m={};port.forEach(o=>{const b=o.banco||'?';if(!m[b])m[b]={d:0,p:0,rd:0,rp:0};m[b].d++;m[b].rd+=(o.vrRepasse||0);if(isFin(o)){m[b].p++;m[b].rp+=(o.vrRepasse||0)}});return Object.entries(m).sort((a,b)=>b[1].d-a[1].d)})()
  const byAg=(()=>{const m={};port.forEach(o=>{const a=o.agente||'?';if(!m[a])m[a]={d:0,p:0,rd:0,rp:0};m[a].d++;m[a].rd+=(o.vrRepasse||0);if(isFin(o)){m[a].p++;m[a].rp+=(o.vrRepasse||0)}});return Object.entries(m).sort((a,b)=>b[1].d-a[1].d)})()
  const PT=({data,nl})=><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr style={{background:C.surface}}>{[nl,'Dig.','Prod.','Conv.','Rep.Dig.','Rep.Prod.'].map(h=><th key={h} style={{padding:'7px 9px',textAlign:'left',color:C.muted,fontSize:8}}>{h}</th>)}</tr></thead><tbody>{data.map(([n,x])=>{const r=x.d?(x.p/x.d*100):0;return<tr key={n} style={{borderBottom:'1px solid '+C.border}}><td style={{padding:'7px 9px',fontWeight:600,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{n}</td><td style={{padding:'7px 9px'}}>{x.d}</td><td style={{padding:'7px 9px',color:C.accent2,fontWeight:600}}>{x.p}</td><td style={{padding:'7px 9px',fontWeight:600,color:r>=50?C.accent2:r>=30?C.warn:C.danger}}>{r.toFixed(0)}%</td><td style={{padding:'7px 9px'}}>{fmtCur(x.rd)}</td><td style={{padding:'7px 9px',fontWeight:600,color:C.accent2}}>{fmtCur(x.rp)}</td></tr>})}</tbody></table>
  return<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <div style={{display:'flex',justifyContent:'space-between'}}><h2 style={{fontWeight:800,fontSize:20}}>Portabilidade</h2><ExportBtn ops={port} name={'portabilidade-'+per}/></div>
    <PeriodBar per={per} setPer={setPer} loading={loading} customDf={customDf} customDt={customDt} setCustomDf={setCustomDf} setCustomDt={setCustomDt} onApplyCustom={applyCustom}/>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><Stat label="Digitado" value={tD} sub={fmtCur(port.reduce((s,o)=>s+(o.vrRepasse||0),0))}/><Stat label="Produção" value={tP} sub={fmtCur(port.filter(isFin).reduce((s,o)=>s+(o.vrRepasse||0),0))} color={C.accent2}/><Stat label="Conv." value={cv.toFixed(1)+'%'} color={cv>=50?C.accent2:cv>=30?C.warn:C.danger}/></div>
    {!port.length?<div style={{background:C.card,borderRadius:14,padding:24,textAlign:'center',color:C.muted}}>Nenhuma portabilidade no período</div>:<>
      <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}><div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Por Banco</div><PT data={byBanco} nl="Banco"/></div>
      <div style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16}}><div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Por Parceiro</div><PT data={byAg} nl="Parceiro"/></div>
    </>}
  </div>
}

/* ═══ ALERTAS — digitação + produção ═══ */
function Alertas({curOps,prevOps,curProd,prevProd}){
  const[selP,setSelP]=useState(null)
  const ags=[...new Set(curOps.concat(prevOps).map(o=>o.agente).filter(Boolean))]
  const st=ags.map(a=>{
    const cu=curOps.filter(o=>o.agente===a),pv=prevOps.filter(o=>o.agente===a)
    const cDig=cu.length,pDig=pv.length
    const cProd=curProd.filter(o=>o.agente===a),pProd=prevProd.filter(o=>o.agente===a)
    const cProdR=cProd.reduce((s,o)=>s+(o.vrRepasse||0),0),pProdR=pProd.reduce((s,o)=>s+(o.vrRepasse||0),0)
    const varDig=pDig?((cDig-pDig)/pDig*100):(cDig>0?100:0)
    const varProd=pProdR?((cProdR-pProdR)/pProdR*100):(cProdR>0?100:0)
    const cv=cDig?(cProd.length/cDig*100):0
    let flag='ok',reason=''
    if(cDig===0&&pDig>0){flag='parado';reason='Sem digitação no mês'}
    else if(cDig>0&&cProd.length===0){flag='sem_producao';reason='Digitando mas sem produção'}
    else if(varProd<=-40){flag='queda_prod';reason='Queda de '+Math.abs(varProd).toFixed(0)+'% na produção'}
    else if(varDig<=-40){flag='queda_dig';reason='Queda de '+Math.abs(varDig).toFixed(0)+'% nas digitações'}
    else if(cv<20&&cDig>5){flag='baixa_conv';reason='Conversão de apenas '+cv.toFixed(0)+'%'}
    return{nm:a,cDig,pDig,cProd:cProd.length,pProd:pProd.length,cProdR,pProdR,varDig,varProd,cv,flag,reason}
  }).sort((a,b)=>{const o={parado:0,sem_producao:1,queda_prod:2,queda_dig:3,baixa_conv:4,ok:5};return(o[a.flag]??9)-(o[b.flag]??9)})
  const alertas=st.filter(s=>s.flag!=='ok')
  const ic=f=>f==='parado'?'🔴':f==='sem_producao'?'🟠':f==='queda_prod'?'🔴':f==='queda_dig'?'🟡':f==='baixa_conv'?'🟡':'↗'
  const vc=v=>v>0?'+'+v.toFixed(0)+'%':v.toFixed(0)+'%'
  const vC=v=>v>0?C.accent2:v<-10?C.danger:C.warn
  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <h2 style={{fontWeight:800,fontSize:20}}>Alertas — Ação em Parceiros</h2>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <Stat label="Parados" value={st.filter(s=>s.flag==='parado').length} color={C.danger}/>
        <Stat label="Sem Produção" value={st.filter(s=>s.flag==='sem_producao').length} color={'#F97316'}/>
        <Stat label="Queda Produção" value={st.filter(s=>s.flag==='queda_prod').length} color={C.danger}/>
        <Stat label="Queda Digitação" value={st.filter(s=>s.flag==='queda_dig').length} color={C.warn}/>
        <Stat label="Baixa Conversão" value={st.filter(s=>s.flag==='baixa_conv').length} color={C.warn}/>
      </div>
      {alertas.length>0&&<div style={{background:'#EF444418',border:'1px solid #EF444433',borderRadius:12,padding:14}}>
        <div style={{fontSize:12,fontWeight:700,color:C.danger,marginBottom:6}}>⚠ {alertas.length} parceiros precisam de ação</div>
        {alertas.slice(0,15).map(s=><div key={s.nm} style={{fontSize:11,padding:'3px 0',cursor:'pointer'}} onClick={()=>setSelP(s.nm)}>
          {ic(s.flag)} <strong>{s.nm}</strong> — <span style={{color:C.muted}}>{s.reason}</span>
        </div>)}
      </div>}
      <div style={{overflowX:'auto',borderRadius:10,border:'1px solid '+C.border}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
          <thead><tr style={{background:C.surface}}>
            {['','Parceiro','Dig.Mês','Dig.Ant.','Var.Dig.','Prod.Mês','Prod.Ant.','Var.Prod.','Conv.','Ação'].map(h=><th key={h} style={{padding:'7px 8px',textAlign:'left',color:C.muted,fontSize:7,textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>)}
          </tr></thead>
          <tbody>{st.map(s=><tr key={s.nm} style={{borderBottom:'1px solid '+C.border,cursor:'pointer'}} onClick={()=>setSelP(s.nm)}>
            <td style={{padding:'6px 8px',fontSize:12}}>{ic(s.flag)}</td>
            <td style={{padding:'6px 8px',fontWeight:600,maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.nm}</td>
            <td style={{padding:'6px 8px'}}>{s.cDig}</td>
            <td style={{padding:'6px 8px',color:C.muted}}>{s.pDig}</td>
            <td style={{padding:'6px 8px',fontWeight:600,color:vC(s.varDig)}}>{vc(s.varDig)}</td>
            <td style={{padding:'6px 8px',fontWeight:600,color:C.accent2}}>{fmtCur(s.cProdR)}</td>
            <td style={{padding:'6px 8px',color:C.muted}}>{fmtCur(s.pProdR)}</td>
            <td style={{padding:'6px 8px',fontWeight:600,color:vC(s.varProd)}}>{vc(s.varProd)}</td>
            <td style={{padding:'6px 8px',fontWeight:600,color:s.cv>=50?C.accent2:s.cv>=30?C.warn:C.danger}}>{s.cv.toFixed(0)}%</td>
            <td style={{padding:'6px 8px',fontSize:9,color:s.flag==='ok'?C.muted:C.danger}}>{s.flag==='ok'?'—':s.reason}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <PartnerHealth name={selP} ops={curOps} onClose={()=>setSelP(null)}/>
    </div>
  )
}

/* ═══ USUARIOS ═══ */
function Usuarios({user}){
  const ALL_TELAS=['dashboard','ops','producao','estrategico','ranking','portabilidade','recebimentos','alertas','parceiros']
  const[users,setUsers]=useState([]),[loading,setLoading]=useState(true),[showNew,setShowNew]=useState(false)
  const[nome,setNome]=useState(''),[email,setEmail]=useState(''),[senha,setSenha]=useState(''),[perfil,setPerfil]=useState('operador'),[msg,setMsg]=useState('')
  const[editTelas,setEditTelas]=useState(null)
  useEffect(()=>{supabase.from('usuarios').select('*').order('nome').then(({data})=>{setUsers(data||[]);setLoading(false)})},[])
  const reload=async()=>{const{data}=await supabase.from('usuarios').select('*').order('nome');setUsers(data||[])}
  if(user.perfil!=='admin')return<div style={{padding:28,textAlign:'center',color:C.muted}}>Restrito</div>
  return<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <div style={{display:'flex',justifyContent:'space-between'}}><h2 style={{fontWeight:800,fontSize:20}}>Usuários</h2><button onClick={()=>setShowNew(!showNew)} style={{background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontWeight:600,fontSize:12,cursor:'pointer'}}>+ Novo</button></div>
    {msg&&<div style={{background:C.accent+'22',color:C.accent,padding:'8px 12px',borderRadius:8,fontSize:12}}>{msg}</div>}
    {showNew&&<form onSubmit={async e=>{e.preventDefault();const{error}=await supabase.from('usuarios').insert({nome,email,senha,perfil,telas:ALL_TELAS.slice(0,3)});if(error){setMsg(error.message);return}setMsg('Criado!');setNome('');setEmail('');setSenha('');setShowNew(false);await reload()}} style={{background:C.card,border:'1px solid '+C.border,borderRadius:14,padding:16,display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr auto',gap:10,alignItems:'end'}}>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:3}}>NOME</label><input value={nome} onChange={e=>setNome(e.target.value)} required style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 10px',fontSize:12,width:'100%',boxSizing:'border-box'}}/></div>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:3}}>EMAIL</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 10px',fontSize:12,width:'100%',boxSizing:'border-box'}}/></div>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:3}}>SENHA</label><input value={senha} onChange={e=>setSenha(e.target.value)} required style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 10px',fontSize:12,width:'100%',boxSizing:'border-box'}}/></div>
      <div><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:3}}>PERFIL</label><select value={perfil} onChange={e=>setPerfil(e.target.value)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'7px 10px',fontSize:12,width:'100%'}}><option value="operador">Operador</option><option value="gestor">Gestor</option><option value="admin">Admin</option></select></div>
      <button type="submit" style={{background:C.accent2,color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontWeight:600,cursor:'pointer'}}>Criar</button>
    </form>}
    {/* TELAS EDIT MODAL */}
    {editTelas&&<div style={{background:C.card,border:'1px solid '+C.accent+'66',borderRadius:14,padding:16}}>
      <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Permissões de tela: <strong style={{color:C.accent}}>{editTelas.nome}</strong></div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
        {ALL_TELAS.map(t=>{const has=(editTelas.telas||[]).includes(t);return<button key={t} onClick={async()=>{const nTelas=has?(editTelas.telas||[]).filter(x=>x!==t):[...(editTelas.telas||[]),t];await supabase.from('usuarios').update({telas:nTelas}).eq('id',editTelas.id);setEditTelas({...editTelas,telas:nTelas});await reload()}} style={{padding:'6px 14px',borderRadius:8,border:'1px solid '+(has?C.accent2:C.border),background:has?C.accent2+'22':'transparent',color:has?C.accent2:C.muted,fontSize:11,fontWeight:has?600:400,cursor:'pointer'}}>{has?'✓ ':''}{t}</button>})}
      </div>
      <button onClick={()=>setEditTelas(null)} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:8,color:C.text,padding:'6px 14px',fontSize:11,cursor:'pointer'}}>Fechar</button>
    </div>}
    {!loading&&<div style={{overflowX:'auto',borderRadius:10,border:'1px solid '+C.border}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr style={{background:C.surface}}>{['Nome','Email','Perfil','Telas','Status','Ações'].map(h=><th key={h} style={{padding:'8px 10px',textAlign:'left',color:C.muted,fontSize:8,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
      <tbody>{users.map(u=><tr key={u.id} style={{borderBottom:'1px solid '+C.border}}>
        <td style={{padding:'8px 10px',fontWeight:600}}>{u.nome}</td>
        <td style={{padding:'8px 10px'}}>{u.email}</td>
        <td style={{padding:'8px 10px'}}><select value={u.perfil} onChange={async e=>{await supabase.from('usuarios').update({perfil:e.target.value}).eq('id',u.id);await reload()}} style={{background:C.surface,border:'1px solid '+C.border,borderRadius:4,color:C.text,padding:'2px 6px',fontSize:10}}><option value="operador">Operador</option><option value="gestor">Gestor</option><option value="admin">Admin</option></select></td>
        <td style={{padding:'8px 10px'}}><button onClick={()=>setEditTelas(u)} style={{background:C.accent+'22',color:C.accent,border:'none',borderRadius:6,padding:'3px 8px',fontSize:10,fontWeight:600,cursor:'pointer'}}>{(u.telas||[]).length} telas ✏</button></td>
        <td style={{padding:'8px 10px'}}><Badge text={u.ativo?'Ativo':'Inativo'} color={u.ativo?C.accent2:C.danger}/></td>
        <td style={{padding:'8px 10px'}}><button onClick={async()=>{await supabase.from('usuarios').update({ativo:!u.ativo}).eq('id',u.id);await reload()}} style={{background:u.ativo?'#EF444418':C.accent2+'22',color:u.ativo?C.danger:C.accent2,border:'none',borderRadius:6,padding:'4px 10px',fontSize:10,fontWeight:600,cursor:'pointer'}}>{u.ativo?'Desativar':'Ativar'}</button></td>
      </tr>)}</tbody></table></div>}
  </div>
}

/* ═══ NAV ═══ */
const NAV=[{id:'dashboard',l:'Dashboard',i:'📊'},{id:'ops',l:'Operações',i:'💼'},{id:'producao',l:'Produção',i:'🏦'},{id:'estrategico',l:'Estratégico',i:'🤝'},{id:'ranking',l:'Ranking',i:'🏆'},{id:'portabilidade',l:'Portabilidade',i:'🔄'},{id:'recebimentos',l:'Recebimentos',i:'💰'},{id:'alertas',l:'Alertas',i:'📈'},{id:'parceiros',l:'Parceiros',i:'🤝'},{id:'usuarios',l:'Usuários',i:'👤'}]

/* ═══ MAIN APP ═══ */
export default function App(){
  const[user,setUser]=useState(null),[view,setView]=useState('dashboard'),[loginError,setLoginError]=useState('')
  const[curOps,setCurOps]=useState([]),[prevOps,setPrevOps]=useState([])
  const[curProd,setCurProd]=useState([]),[prevProd,setPrevProd]=useState([])
  const[prevProdProp,setPrevProdProp]=useState([])
  const[m2Prop,setM2Prop]=useState([]),[m3Prop,setM3Prop]=useState([])
  useEffect(()=>{try{const s=localStorage.getItem('om-session');if(s){const u=JSON.parse(s);if(u?.nome)setUser(u)}}catch(e){}},[])
  useEffect(()=>{if(!user)return
    const day=NOW.getDate(),y=NOW.getFullYear(),mo=NOW.getMonth()
    const propRange=(mBack)=>{const f=new Date(y,mo-mBack,1).toISOString().split('T')[0];const t=new Date(y,mo-mBack,day).toISOString().split('T')[0];return[f,t]}
    fetchOps('mes').then(d=>setCurOps(d)).catch(()=>{})
    fetchOps('ant').then(d=>setPrevOps(d)).catch(()=>{})
    fetchProd('mes').then(d=>setCurProd(d)).catch(()=>{})
    fetchProd('ant').then(d=>setPrevProd(d)).catch(()=>{})
    // Proporcional até dia X de cada mês
    const[pf1,pt1]=propRange(1);fetchProd('custom',null,pf1,pt1).then(d=>setPrevProdProp(d)).catch(()=>{})
    const[pf2,pt2]=propRange(2);fetchProd('custom',null,pf2,pt2).then(d=>setM2Prop(d)).catch(()=>{})
    const[pf3,pt3]=propRange(3);fetchProd('custom',null,pf3,pt3).then(d=>setM3Prop(d)).catch(()=>{})
  },[user])

  async function handleLogin(e){e.preventDefault();setLoginError('');const fd=new FormData(e.target);const{data,error}=await supabase.from('usuarios').select('*').eq('email',fd.get('email')).eq('senha',fd.get('senha')).eq('ativo',true).single();if(error||!data){setLoginError('Email/senha incorretos');return}supabase.from('usuarios').update({ultimo_acesso:new Date().toISOString()}).eq('id',data.id).then(()=>{});const session={id:data.id,nome:data.nome,email:data.email,perfil:data.perfil,telas:data.telas||["dashboard","ops","producao"]};localStorage.setItem('om-session',JSON.stringify(session));setUser(session)}
  async function handleImport(batch){const{error}=await supabase.from('digitacoes').upsert(batch.map(toDb),{onConflict:'proposta,banco',ignoreDuplicates:false});if(error)await supabase.from('digitacoes').insert(batch.map(toDb))}

  if(!user)return<div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg,fontFamily:'Outfit,sans-serif',color:C.text}}><form onSubmit={handleLogin} style={{background:C.card,border:'1px solid '+C.border,borderRadius:20,padding:'40px 36px',width:380}}><div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}><div style={{width:36,height:36,borderRadius:10,background:'linear-gradient(135deg,'+C.accent+','+C.accent2+')',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:800,color:'#fff'}}>O</div><h1 style={{fontSize:22,fontWeight:800,margin:0}}>OpsManager</h1></div><p style={{color:C.muted,fontSize:12,marginBottom:24}}>Gestão de Digitações</p>{loginError&&<div style={{background:'#EF444418',color:C.danger,padding:'8px 12px',borderRadius:8,fontSize:12,marginBottom:12}}>{loginError}</div>}<div style={{marginBottom:8}}><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:3}}>EMAIL</label><input name="email" type="email" required placeholder="seu@email.com" style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'10px 12px',fontSize:13,outline:'none',width:'100%',boxSizing:'border-box',fontFamily:'Outfit,sans-serif'}}/></div><div style={{marginBottom:16}}><label style={{fontSize:9,color:C.muted,fontWeight:600,display:'block',marginBottom:3}}>SENHA</label><input name="senha" type="password" required placeholder="Sua senha" style={{background:C.surface,border:'1px solid '+C.border,borderRadius:7,color:C.text,padding:'10px 12px',fontSize:13,outline:'none',width:'100%',boxSizing:'border-box',fontFamily:'Outfit,sans-serif'}}/></div><button type="submit" style={{width:'100%',padding:'12px 0',fontSize:14,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontWeight:700,cursor:'pointer',fontFamily:'Outfit,sans-serif'}}>Entrar</button></form></div>

  const levels={operador:1,gestor:2,admin:3},nav=NAV.filter(n=>{if(user.perfil==='admin')return true;return(user.telas||['dashboard','ops','producao']).includes(n.id)})
  return<div style={{display:'flex',minHeight:'100vh',fontFamily:'Outfit,sans-serif',color:C.text,background:C.bg}}>
    <div style={{width:195,background:C.card,borderRight:'1px solid '+C.border,display:'flex',flexDirection:'column',flexShrink:0}}>
      <div style={{padding:'20px 14px 10px'}}><div style={{display:'flex',alignItems:'center',gap:7}}><div style={{width:26,height:26,borderRadius:7,background:'linear-gradient(135deg,'+C.accent+','+C.accent2+')',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,color:'#fff'}}>O</div><h1 style={{fontSize:14,fontWeight:800,margin:0}}>OpsManager</h1></div><div style={{fontSize:8,color:C.accent2,marginTop:4,marginLeft:33}}>● Supabase</div></div>
      <nav style={{flex:1,padding:'2px 7px',overflowY:'auto'}}>{nav.map(n=><button key={n.id} onClick={()=>setView(n.id)} style={{display:'flex',alignItems:'center',gap:7,width:'100%',padding:'7px 9px',marginBottom:1,borderRadius:7,border:'none',background:view===n.id?C.abg:'transparent',color:view===n.id?C.accent:C.muted,fontFamily:'Outfit,sans-serif',fontSize:11,fontWeight:view===n.id?600:400,cursor:'pointer',textAlign:'left'}}><span style={{fontSize:13}}>{n.i}</span>{n.l}</button>)}</nav>
      <div style={{padding:'10px 14px',borderTop:'1px solid '+C.border}}><div style={{fontSize:11,fontWeight:600}}>{user.nome}</div><div style={{fontSize:9,color:C.muted,marginBottom:4}}>{user.perfil}</div><button onClick={()=>{localStorage.removeItem('om-session');setUser(null)}} style={{fontSize:9,color:C.danger,background:'none',border:'none',cursor:'pointer',padding:0}}>Sair →</button></div>
    </div>
    <div style={{flex:1,padding:'20px 24px',overflowY:'auto'}}>
      {view==='dashboard'&&<Dashboard curOps={curOps} prevOps={prevOps} curProd={curProd} prevProd={prevProd} prevProdProp={prevProdProp} m2Prop={m2Prop} m3Prop={m3Prop}/>}
      {view==='ops'&&<Operacoes onImport={handleImport}/>}
      {view==='producao'&&<Producao/>}
      {view==='estrategico'&&<Estrategico/>}
      {view==='ranking'&&<Ranking/>}
      {view==='portabilidade'&&<Portabilidade/>}
      {view==='recebimentos'&&<Recebimentos/>}
      {view==='alertas'&&<Alertas curOps={curOps} prevOps={prevOps} curProd={curProd} prevProd={prevProd}/>}
      {view==='parceiros'&&<Parceiros/>}
      {view==='usuarios'&&<Usuarios user={user}/>}
    </div>
  </div>
}
