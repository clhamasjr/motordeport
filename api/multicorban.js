// api/multicorban.js — Proxy Multicorban — FlowForce LhamasCred
// Suporte a múltiplos benefícios + parser Bootstrap cards contratos
const BASE='https://app.multicorban.com';
let sessionCache={cookie:null,ts:0};const SESSION_TTL=25*60*1000;
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...CORS,'Content-Type':'application/json'}})}

async function doLogin(user,pass){
  const body=new URLSearchParams({login:user,senha:pass});
  const res=await fetch(`${BASE}/access/validateLogin`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest','Referer':`${BASE}/`,'Origin':BASE},body:body.toString(),redirect:'manual'});
  const cookies=[];
  if(typeof res.headers.getSetCookie==='function'){cookies.push(...res.headers.getSetCookie())}else{const raw=res.headers.get('set-cookie');if(raw)cookies.push(...raw.split(/,(?=\s*\w+=)/))}
  let loginData;try{loginData=await res.json()}catch{loginData={code:-1,mensagem:'Failed to parse'}}
  if(loginData.code!==0)return{ok:false,error:loginData.mensagem||'Login failed',data:loginData};
  const cookieStr=cookies.map(c=>c.split(';')[0].trim()).filter(Boolean).join('; ');
  if(!cookieStr)return{ok:false,error:'No session cookie',data:loginData};
  return{ok:true,cookie:cookieStr,data:loginData};
}

async function ensureSession(user,pass){
  const now=Date.now();
  if(sessionCache.cookie&&(now-sessionCache.ts)<SESSION_TTL)return{ok:true,cookie:sessionCache.cookie};
  const result=await doLogin(user,pass);
  if(result.ok)sessionCache={cookie:result.cookie,ts:now};
  return result;
}

function parseListHTML(html){
  const lista=[];
  const rowRe=/<tr[^>]*>[\s\S]*?<\/tr>/gi;
  const rows=html.match(rowRe)||[];
  for(const row of rows){
    if(/<th/i.test(row))continue;
    const cellRe=/<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells=[];let cm;
    while((cm=cellRe.exec(row))!==null)cells.push(cm[1].replace(/<[^>]*>/g,'').trim());
    if(cells.length>=4){
      let nb='',nome='',valor='',especie='',situacao='',ddb='';
      for(const cell of cells){
        if(!nb&&/^\d{7,12}$/.test(cell.replace(/\D/g,''))&&cell.replace(/\D/g,'').length>=7)nb=cell.replace(/\D/g,'');
        if(!nome&&cell.length>5&&/^[A-ZÁÉÍÓÚÃÕÂÊÔÇ\s]+$/i.test(cell))nome=cell;
        if(!valor&&/R\$/.test(cell)){const vm=cell.match(/R\$\s*([\d.,]+)/);if(vm)valor=vm[1]}
        if(!especie&&/^\d{1,2}$/.test(cell.trim()))especie=cell.trim();
        if(!situacao&&/ATIVO|CESSADO|SUSPENSO|INATIVO/i.test(cell))situacao=cell.trim().toUpperCase();
        if(!ddb&&/^\d{2}\/\d{2}\/\d{4}$/.test(cell.trim()))ddb=cell.trim();
      }
      if(nb)lista.push({nb,nome,valor,especie,situacao,ddb});
    }
  }
  return lista;
}

async function consultCPF(cookie,cpf){
  const cpfClean=cpf.replace(/\D/g,'').padStart(11,'0');
  const body=new URLSearchParams({methodOperation:'dataBase',methodConsult:'cpf',versaoTela:'v2',dataConsult:cpfClean,dataOrgao:'',CPF:'',CPFRepresentante:'',ddd:'',telefone:''});
  const res=await fetch(`${BASE}/search/consult`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest','Cookie':cookie,'Referer':`${BASE}/search`,'Origin':BASE},body:body.toString()});
  const text=await res.text();
  let data;try{data=JSON.parse(text)}catch{return{ok:false,error:'Non-JSON response',raw:text.substring(0,500)}}
  if(data.code!==undefined&&data.code!==0)return{ok:false,error:data.mensagem||'Consulta error',data};
  const html=data.hash||'';
  const hasDetail=/nome_beneficiario|nb_beneficiario|valor_beneficio/i.test(html);
  const hasList=/<tr[\s\S]*?<\/tr>/i.test(html)&&!hasDetail;
  if(hasList||(!hasDetail&&/<table/i.test(html))){
    const lista=parseListHTML(html);
    if(lista.length>0){
      const ativo=lista.find(l=>l.situacao==='ATIVO')||lista[0];
      if(ativo&&ativo.nb){
        const benefResult=await consultBeneficio(cookie,ativo.nb);
        if(benefResult.ok)return{ok:true,cpf:cpfClean,parsed:benefResult.parsed,lista,auto_selected:ativo.nb,raw_code:data.code};
      }
      return{ok:true,cpf:cpfClean,parsed:{beneficiario:{cpf:cpfClean,nome:lista[0].nome||''},beneficio:{},margem:{},contratos:[],cartoes:[],telefones:[],endereco:{},banco:{}},lista,raw_code:data.code};
    }
    return{ok:false,error:'Múltiplos benefícios — use consulta por benefício',raw:html.substring(0,1000)};
  }
  const parsed=parseConsultHTML(html);
  return{ok:true,cpf:cpfClean,parsed,raw_code:data.code};
}

function parseConsultHTML(html){
  const result={beneficiario:{},beneficio:{},margem:{},contratos:[],cartoes:[],telefones:[],endereco:{},banco:{}};
  if(!html)return result;
  const ei=(id)=>{const re=new RegExp(`id="\\s*${id}"[^>]*value="\\s*([^"]*)"`,`i`);const m=html.match(re);return m?m[1].trim():null};
  let m;
  result.beneficiario.cpf=ei('cpf_beneficiario');
  result.beneficiario.nome=ei('nome_beneficiario');
  result.beneficiario.rg=ei('rg_beneficiario');
  result.beneficiario.nome_mae=ei('nomeMae_beneficiario');
  result.beneficiario.nb=ei('nb_beneficiario');
  m=html.match(/Data de Nascimento<\/small>\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.beneficiario.data_nascimento=m[1].trim();
  m=html.match(/Idade<\/small>\s*(?:<[^>]*>)*\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.beneficiario.idade=m[1].trim();
  result.beneficio.valor=ei('valor_beneficio');
  result.beneficio.base_calculo=ei('base_calculo_consignavel');
  m=html.match(/Situa[çc]\u00e3o:\s*<\/small>\s*<small[^>]*>\s*(\w+)/i);if(m)result.beneficio.situacao=m[1].trim();
  m=html.match(/Descri[çc]\u00e3o da Esp\u00e9cie<\/small>\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.beneficio.especie=m[1].trim();
  m=html.match(/Data do extrato:\s*<\/small>\s*<small[^>]*>\s*([^<]+)/i);if(m)result.beneficio.data_extrato=m[1].trim();
  m=html.match(/DDB<\/small>\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.beneficio.ddb=m[1].trim();
  m=html.match(/Desbloqueio<\/small>\s*(?:<[^>]*>)*\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.beneficio.desbloqueio=m[1].trim();
  result.margem.parcelas=ei('valor_parcela_emprestimo');
  result.margem.total=ei('margem_total');
  m=html.match(/Margem:\s*<\/small>\s*<small[^>]*>\s*R\$\s*([\d.,]+)/i);if(m)result.margem.disponivel=m[1].trim();
  m=html.match(/valor_parcela_rmc[^>]*>\s*R\$\s*([\d.,]+)/i);if(m)result.margem.rmc=m[1].trim();
  m=html.match(/valor_parcela_rcc[^>]*>\s*R\$\s*([\d.,]+)/i);if(m)result.margem.rcc=m[1].trim();

// ═══ CONTRATOS — Bootstrap card extraction (Multicorban v2) ═══
  // Structure: each contract in <div class="card mb-4"> inside navs-tab-contrato
  // Bank: <img src="/upload/icones/329.png"> + <small>329 - QI S.C.D</small>
  // Fields: <small>Label</small><p>Value</p>
  const contratoSection=html.indexOf('id="navs-tab-contrato"');
  if(contratoSection>=0){
    const cBlock=html.substring(contratoSection,contratoSection+50000);
    const cards=cBlock.split(/card\s+mb-4/);
    for(let i=1;i<cards.length;i++){
      const card=cards[i];
      const getField=(label)=>{
        const re=new RegExp(label+'<\\/small>[\\s\\S]*?<p[^>]*>\\s*([\\s\\S]*?)<\\/p>','i');
        const fm=card.match(re);
        return fm?fm[1].replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim():'';
      };
      const contrato=getField('Contrato');
      const taxa=getField('Taxa');
      const valor=getField('Valor');
      const parcela=getField('Parcela');
      const prazos=getField('Prazos');
      const dataAverb=getField('Data Averba');
      // Bank code from icon
      let banco_codigo='';
      const iconM=card.match(/icones\/(\d{3})\.png/);
      if(iconM)banco_codigo=iconM[1];
      if(!banco_codigo){const btm=card.match(/(\d{3})\s*-\s*[A-Z]/);if(btm)banco_codigo=btm[1]}
      // Parse prazo: "90 / 96"
      let prazo_rest='',prazo_total='';
      if(prazos){const pm=prazos.match(/(\d+)\s*\/\s*(\d+)/);if(pm){prazo_rest=pm[1];prazo_total=pm[2]}}
      // Parse valor averbado (empréstimo original)
      let valorAverb='';if(valor){const vm=valor.match(/R\$\s*([\d.,]+)/);if(vm)valorAverb=vm[1]}
      // Parse saldo devedor (campo expandido do card)
      const saldoDev=getField('Saldo Devedor');
      let saldo='';
      if(saldoDev){const sm=saldoDev.match(/([\d.,]+)/);if(sm)saldo=sm[1]}
      // Fallback: valor averbado
      if(!saldo&&valor){const vm=valor.match(/R\$\s*([\d.,]+)/);if(vm)saldo=vm[1]}
      // Parse parcela
      let parcelaClean='';if(parcela){const pm2=parcela.match(/R\$\s*([\d.,]+)/);if(pm2)parcelaClean=pm2[1]}
      if(contrato){
      result.contratos.push({contrato:contrato.replace(/[^0-9A-Za-z]/g,''),banco_codigo,parcela:parcelaClean,saldo,valor_averbado:valorAverb,taxa:taxa.trim(),prazo:prazo_rest,prazo_original:prazo_total,data_averbacao:dataAverb});      }
    }
  }
  // Fallback: simple contrato number extraction
  if(!result.contratos.length){
    const cnRe=/Contrato<\/small>\s*<p[^>]*>\s*([\d\w]+)/gi;let cn;
    while((cn=cnRe.exec(html))!==null)result.contratos.push({contrato:cn[1].trim()});
  }

  // Cartões RMC/RCC
  const cartRe=/Cart[aã]o \((RM[C]|RCC)\)/gi;
  let cartMatch;
  while((cartMatch=cartRe.exec(html))!==null){
    const tipo=cartMatch[1];
    const afterCart=html.substring(cartMatch.index,cartMatch.index+2000);
    let margem='',limite='',banco='';
    const mrgM=afterCart.match(/Margem<\/small>\s*<p[^>]*>\s*R\$\s*([\d.,]+)/i);if(mrgM)margem=mrgM[1];
    const limM=afterCart.match(/Limite Cart[aã]o<\/small>\s*<p[^>]*>\s*R\$\s*([\d.,]+)/i);if(limM)limite=limM[1];
    const liqM=afterCart.match(/Valor L[ií]quido<\/small>\s*<p[^>]*>\s*R\$\s*([\d.,]+)/i);if(liqM&&!limite)limite=liqM[1];
    const bancoM=afterCart.match(/Banco<\/small>\s*<p[^>]*>\s*([^<]+)/i);if(bancoM)banco=bancoM[1].trim();
    result.cartoes.push({tipo,banco,margem:margem||'0,00',limite:limite||'0,00'});
  }

  // Telefones
  const telRe=/phone=55(\d+)"/gi;let tl;
  while((tl=telRe.exec(html))!==null){if(!result.telefones.includes(tl[1]))result.telefones.push(tl[1])}
  const fxRe=/class="phone_fixo"[^>]*>\s*(\d+)/gi;let fx;
  while((fx=fxRe.exec(html))!==null){if(!result.telefones.includes(fx[1]))result.telefones.push(fx[1])}

  // Endereço
  m=html.match(/UF<\/small>\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.endereco.uf=m[1].trim();
  m=html.match(/Munic[ií]pio<\/small>\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.endereco.municipio=m[1].trim();
  m=html.match(/CEP<\/small>\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.endereco.cep=m[1].trim();
  m=html.match(/Endere[çc]o<\/small>\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.endereco.endereco=m[1].trim();

  // Banco pagador
  m=html.match(/Banco<\/small>\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.banco.nome=m[1].trim();
  m=html.match(/Agencia<\/small>\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.banco.agencia=m[1].trim();
  m=html.match(/Conta<\/small>\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.banco.conta=m[1].trim();
  m=html.match(/Tipo de Conta<\/small>\s*<input[^>]*value="\s*([^"]+)"/i);if(m)result.banco.tipo=m[1].trim();
  return result;
}

async function consultBeneficio(cookie,beneficio){
  const nbClean=beneficio.replace(/\D/g,'');
  const body=new URLSearchParams({methodOperation:'dataBase',methodConsult:'beneficio',versaoTela:'v2',dataConsult:nbClean,dataOrgao:'',CPF:'',CPFRepresentante:'',ddd:'',telefone:''});
  const res=await fetch(`${BASE}/search/consult`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest','Cookie':cookie,'Referer':`${BASE}/search`,'Origin':BASE},body:body.toString()});
  const text=await res.text();
  let data;try{data=JSON.parse(text)}catch{return{ok:false,error:'Non-JSON response',raw:text.substring(0,500)}}
  if(data.code!==undefined&&data.code!==0)return{ok:false,error:data.mensagem||'Consulta error',data};
  const html=data.hash||'';
  const parsed=parseConsultHTML(html);
  return{ok:true,beneficio:nbClean,parsed,raw_code:data.code};
}

export default async function handler(req){
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
  if(req.method!=='POST')return json({error:'POST only'},405);
  let body;try{body=await req.json()}catch{return json({error:'Invalid JSON body'},400)}
  const{action,user,pass,cpf,beneficio}=body;
  const loginUser=user||'lhamascred';const loginPass=pass||'*Lhamas24';
  try{
    if(action==='login'){const result=await doLogin(loginUser,loginPass);if(result.ok){sessionCache={cookie:result.cookie,ts:Date.now()};return json({ok:true,mensagem:'Sessão ativa',data:result.data})}return json({ok:false,error:result.error},401)}
    if(action==='consult_cpf'){
      if(!cpf)return json({error:'CPF obrigatório'},400);
      const session=await ensureSession(loginUser,loginPass);if(!session.ok)return json({ok:false,error:'Login failed: '+session.error},401);
      const result=await consultCPF(session.cookie,cpf);
      if(!result.ok&&(result.error||'').includes('session')){sessionCache={cookie:null,ts:0};const retry=await ensureSession(loginUser,loginPass);if(retry.ok){const r2=await consultCPF(retry.cookie,cpf);return json(r2,r2.ok?200:400)}}
      return json(result,result.ok?200:400);
    }
    if(action==='consult_beneficio'){
      if(!beneficio)return json({error:'Benefício obrigatório'},400);
      const session=await ensureSession(loginUser,loginPass);if(!session.ok)return json({ok:false,error:'Login failed: '+session.error},401);
      const result=await consultBeneficio(session.cookie,beneficio);return json(result,result.ok?200:400);
    }
    if(action==='raw'){
      const{endpoint,params}=body;if(!endpoint)return json({error:'endpoint obrigatório'},400);
      const session=await ensureSession(loginUser,loginPass);if(!session.ok)return json({ok:false,error:'Login failed'},401);
      const formBody=new URLSearchParams(params||{});
      const res=await fetch(`${BASE}${endpoint}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest','Cookie':session.cookie,'Referer':`${BASE}/search`,'Origin':BASE},body:formBody.toString()});
      const text=await res.text();try{return json(JSON.parse(text))}catch{return json({raw:text.substring(0,5000)})}
    }
    return json({error:'action inválida',actions:['login','consult_cpf','consult_beneficio','raw']},400);
  }catch(e){return json({error:e.message,stack:e.stack?.substring(0,300)},500)}
}
export const config={runtime:'edge'};
