export const TOOL_ID='contract-test-fixture-maker';
export const LIMITS=Object.freeze({schemaBytes:65536,fields:20,depth:16,milliseconds:5000});
export const RULES=Object.freeze({'constraint-conflict':'error','schema-invalid':'warning','input-unreadable':'warning','limit-exceeded':'warning'});
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const only=(x,keys)=>Object.keys(x).every(k=>keys.includes(k));
const validName=x=>typeof x==='string'&&/^[a-z][a-z0-9_]{0,31}$/u.test(x);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function report(findings,checked,cases){
  findings.sort((a,b)=>cmp(a.location.file,b.location.file)||cmp(a.location.pointer,b.location.pointer)||cmp(a.ruleId,b.ruleId));
  const warnings=findings.filter(f=>f.severity==='warning').length,errors=findings.filter(f=>f.severity==='error').length;
  return{schemaVersion:'1',tool:TOOL_ID,status:warnings?'incomplete':errors?'fail':cases>0?'pass':'incomplete',summary:{checked,cases,errors,warnings},findings};
}
export function finding(ruleId,pointer,message){
  if(!Object.hasOwn(RULES,ruleId))throw new Error('Unknown rule');
  return{ruleId,severity:RULES[ruleId],message,location:{file:'@schema',pointer}};
}
export function incompleteReport(ruleId,message){return report([finding(ruleId,'',message)],0,0);}
export function generateFixtures(schema,{seed=0,now=Date.now,deadline=now()+LIMITS.milliseconds}={}){
  const abort=(id,pointer,message,checked=0)=>({report:report([finding(id,pointer,message)],checked,0),artifact:null});
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)return abort('schema-invalid','','Seed is invalid.');
  if(now()>deadline)return abort('limit-exceeded','','Generation deadline exceeded.');
  if(!obj(schema)||!only(schema,['schemaVersion','complete','fields'])||schema.schemaVersion!=='1'||schema.complete!==true||!Array.isArray(schema.fields)||schema.fields.length===0)return abort('schema-invalid','','Schema evidence is incomplete or unsupported.');
  if(schema.fields.length>LIMITS.fields)return abort('limit-exceeded','/fields','Field count exceeds limit.');
  const names=new Set();
  for(let i=0;i<schema.fields.length;i++){
    if(now()>deadline)return abort('limit-exceeded','','Generation deadline exceeded.',i);
    const f=schema.fields[i],at=`/fields/${i}`;
    if(!obj(f)||!validName(f.name)||names.has(f.name)||!['string','integer'].includes(f.type)||typeof f.required!=='boolean')return abort('schema-invalid',at,'Field contract is incomplete or unsupported.',i);
    names.add(f.name);
    if(f.type==='string'){
      if(!only(f,['name','type','required','minLength','maxLength'])||!Number.isSafeInteger(f.minLength)||!Number.isSafeInteger(f.maxLength)||f.minLength<0||f.minLength>32||f.maxLength<0||f.maxLength>32)return abort('schema-invalid',at,'String bounds are incomplete or unsupported.',i);
      if(f.minLength>f.maxLength)return abort('constraint-conflict',at,'String constraints cannot be satisfied.',i);
    }else{
      if(!only(f,['name','type','required','minimum','maximum'])||!Number.isSafeInteger(f.minimum)||!Number.isSafeInteger(f.maximum)||f.minimum< -1000||f.minimum>1000||f.maximum< -1000||f.maximum>1000)return abort('schema-invalid',at,'Integer bounds are incomplete or unsupported.',i);
      if(f.minimum>f.maximum)return abort('constraint-conflict',at,'Integer constraints cannot be satisfied.',i);
    }
  }
  let state=seed>>>0;
  const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  const word=n=>Array.from({length:n},()=>String.fromCharCode(97+rand()%26)).join('');
  const valid={};
  for(const f of schema.fields){
    valid[f.name]=f.type==='string'?word(Math.min(f.maxLength,Math.max(f.minLength,Math.min(3,f.maxLength)))):f.minimum+rand()%(f.maximum-f.minimum+1);
  }
  const cases=[{expectedRule:'valid',fieldOrdinal:null,record:{...valid}}];
  const add=(i,rule,edit)=>{const record={...valid};edit(record);cases.push({expectedRule:rule,fieldOrdinal:i,record});};
  for(let i=0;i<schema.fields.length;i++){
    if(now()>deadline)return abort('limit-exceeded','','Generation deadline exceeded.',i);
    const f=schema.fields[i];
    if(f.required)add(i,'required',r=>delete r[f.name]);
    add(i,'type',r=>r[f.name]={});
    if(f.type==='string'){
      if(f.minLength>0)add(i,'min-length',r=>r[f.name]=word(f.minLength-1));
      add(i,'max-length',r=>r[f.name]=word(f.maxLength+1));
    }else{
      add(i,'minimum',r=>r[f.name]=f.minimum-1);
      add(i,'maximum',r=>r[f.name]=f.maximum+1);
    }
  }
  return{report:report([],schema.fields.length,cases.length),artifact:{schemaVersion:'1',seed,cases}};
}
