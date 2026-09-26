import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, symlinkSync, linkSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateFixtures, TOOL_ID, LIMITS, RULES} from '../src/index.mjs';
import {runCli} from '../src/cli.mjs';

const schema=()=>({schemaVersion:'1',complete:true,fields:[
  {name:'label',type:'string',required:true,minLength:2,maxLength:4},
  {name:'count',type:'integer',required:true,minimum:1,maximum:3},
]});
const run=(args,now=()=>0)=>{let stdout='',stderr='';const code=runCli(args,{stdout:{write:x=>stdout+=x},stderr:{write:x=>stderr+=x},now});return{code,stdout,stderr,report:stdout?JSON.parse(stdout):null};};
const temp=()=>mkdtempSync(join(tmpdir(),'fixture-maker-'));
const violations=(field,value,present)=>{
  if(!present)return field.required?['required']:[];
  if(field.type==='string'){
    if(typeof value!=='string')return ['type'];
    return [...(value.length<field.minLength?['min-length']:[]),...(value.length>field.maxLength?['max-length']:[])];
  }
  if(!Number.isSafeInteger(value))return ['type'];
  return [...(value<field.minimum?['minimum']:[]),...(value>field.maximum?['maximum']:[])];
};
const independentlyValidate=(s,record)=>s.fields.flatMap((field,i)=>violations(field,record[field.name],Object.hasOwn(record,field.name)).map(rule=>`${i}:${rule}`));

test('good schema generates independently valid and single-rule invalid cases',()=>{
  const result=generateFixtures(schema(),{seed:7,now:()=>0,deadline:5000});
  assert.equal(result.report.status,'pass');
  assert.equal(result.report.tool,TOOL_ID);
  assert.deepEqual(result.report.findings,[]);
  assert.equal(result.artifact.cases[0].expectedRule,'valid');
  for(const c of result.artifact.cases){
    const found=independentlyValidate(schema(),c.record);
    assert.deepEqual(found,c.expectedRule==='valid'?[]:[`${c.fieldOrdinal}:${c.expectedRule}`]);
  }
  assert.deepEqual(generateFixtures(schema(),{seed:7,now:()=>0,deadline:5000}),result);
  assert.notDeepEqual(generateFixtures(schema(),{seed:8,now:()=>0,deadline:5000}).artifact.cases[0],result.artifact.cases[0]);
});

test('conflicting constraints fail without an artifact',()=>{
  const s=schema();s.fields[0].minLength=5;
  const r=generateFixtures(s,{seed:1,now:()=>0,deadline:5000});
  assert.equal(r.report.status,'fail');assert.equal(r.artifact,null);
  assert.equal(r.report.findings[0].ruleId,'constraint-conflict');
  assert.equal(r.report.findings[0].location.pointer,'/fields/0');
});

test('partial, unknown and missing schema evidence cannot pass',()=>{
  for(const change of [s=>{s.complete=false},s=>{delete s.complete},s=>{s.unknown=true},s=>{s.fields[0].unknown=true}]){
    const s=schema();change(s);const r=generateFixtures(s,{seed:1,now:()=>0,deadline:5000});
    assert.equal(r.report.status,'incomplete');assert.equal(r.artifact,null);
  }
});

test('field-count and clock bounds have both sides',()=>{
  const s={schemaVersion:'1',complete:true,fields:Array.from({length:LIMITS.fields},(_,i)=>({name:`f${i}`,type:'string',required:true,minLength:1,maxLength:2}))};
  assert.equal(generateFixtures(s,{seed:1,now:()=>5000,deadline:5000}).report.status,'pass');
  s.fields.push({name:'extra',type:'string',required:true,minLength:1,maxLength:2});
  assert.equal(generateFixtures(s,{seed:1,now:()=>0,deadline:5000}).report.status,'incomplete');
  assert.equal(generateFixtures(schema(),{seed:1,now:()=>5001,deadline:5000}).report.status,'incomplete');
});

test('CLI passes and writes separate synthetic artifact; failing schema exits 1',()=>{
  const dir=temp();try{
    writeFileSync(join(dir,'schema.json'),JSON.stringify(schema()));
    const a=run(['--root',dir,'--schema','schema.json','--seed','7','--out','fixtures.json']);
    assert.equal(a.code,0);assert.equal(a.report.status,'pass');assert.equal(a.report.summary.cases,9);
    const artifact=JSON.parse(readFileSync(join(dir,'fixtures.json'),'utf8'));
    assert.equal(artifact.cases.length,9);assert.ok(!a.stdout.includes(dir));
    const s=schema();s.fields[0].minLength=5;writeFileSync(join(dir,'schema.json'),JSON.stringify(s));
    const b=run(['--root',dir,'--schema','schema.json','--seed','7','--out','bad.json']);
    assert.equal(b.code,1);assert.equal(b.report.status,'fail');
    assert.throws(()=>readFileSync(join(dir,'bad.json')));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('CLI configuration error has empty stdout; unreadable input has incomplete report',()=>{
  const dir=temp();try{
    assert.deepEqual([run(['--root',join(dir,'missing'),'--schema','x','--seed','1','--out','x']).code,run(['--root',dir,'--schema','x','--seed','wat','--out','x']).stdout],[2,'']);
    const r=run(['--root',dir,'--schema','absent.json','--seed','1','--out','x.json']);
    assert.equal(r.code,2);assert.equal(r.report.status,'incomplete');assert.equal(r.report.findings[0].ruleId,'input-unreadable');
    assert.ok(!r.stdout.includes(dir));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('raw and escaped duplicate JSON keys cannot pass',()=>{
  const dir=temp();try{
    for(const raw of ['{"schemaVersion":"1","complete":false,"complete":true,"fields":[]}', '{"schemaVersion":"1","complete":false,"com\\u0070lete":true,"fields":[]}']){
      writeFileSync(join(dir,'schema.json'),raw);
      const r=run(['--root',dir,'--schema','schema.json','--seed','1','--out','x.json']);
      assert.equal(r.code,2);assert.equal(r.report.status,'incomplete');assert.equal(r.report.findings[0].ruleId,'schema-invalid');
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('schema byte and depth limits have both sides',()=>{
  const dir=temp();try{
    const s=schema();s.fields[0].name='label';
    let raw=JSON.stringify(s);raw+=' '.repeat(LIMITS.schemaBytes-Buffer.byteLength(raw));
    writeFileSync(join(dir,'schema.json'),raw);
    assert.equal(run(['--root',dir,'--schema','schema.json','--seed','1','--out','a.json']).code,0);
    writeFileSync(join(dir,'schema.json'),raw+' ');
    assert.equal(run(['--root',dir,'--schema','schema.json','--seed','1','--out','b.json']).report.findings[0].ruleId,'limit-exceeded');
    const nest=n=>JSON.parse('{"schemaVersion":"1","complete":true,"fields":'+JSON.stringify(s.fields)+',"extra":'+ '['.repeat(n)+'0'+']'.repeat(n)+'}');
    // Unknown evidence remains incomplete at the legal depth; N+1 names the depth limit.
    writeFileSync(join(dir,'schema.json'),JSON.stringify(nest(LIMITS.depth-1)));
    assert.equal(run(['--root',dir,'--schema','schema.json','--seed','1','--out','c.json']).report.findings[0].ruleId,'schema-invalid');
    writeFileSync(join(dir,'schema.json'),JSON.stringify(nest(LIMITS.depth)));
    assert.equal(run(['--root',dir,'--schema','schema.json','--seed','1','--out','d.json']).report.findings[0].ruleId,'limit-exceeded');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('read confinement rejects symlink escape without leaking target',()=>{
  const dir=temp(),outside=temp();try{
    writeFileSync(join(outside,'schema.json'),JSON.stringify(schema()));symlinkSync(join(outside,'schema.json'),join(dir,'schema.json'));
    const r=run(['--root',dir,'--schema','schema.json','--seed','1','--out','x.json']);
    assert.equal(r.code,2);assert.equal(r.stdout,'');assert.ok(!r.stderr.includes(outside));
  }finally{rmSync(dir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('write guard rejects destination symlink, symlinked parent, and input hardlink',()=>{
  const dir=temp(),outside=temp();try{
    writeFileSync(join(dir,'schema.json'),JSON.stringify(schema()));writeFileSync(join(outside,'safe.txt'),'untouched');
    symlinkSync(join(outside,'safe.txt'),join(dir,'link.json'));
    symlinkSync(outside,join(dir,'escape'));
    linkSync(join(dir,'schema.json'),join(dir,'hard.json'));
    for(const [out,why] of [['link.json','symbolic link'],['escape/new.json','outside the root'],['hard.json','aliases an input']]){
      const r=run(['--root',dir,'--schema','schema.json','--seed','1','--out',out]);
      assert.equal(r.code,2);assert.equal(r.stdout,'');assert.match(r.stderr,/destination/i);assert.ok(r.stderr.includes(why));
    }
    assert.equal(readFileSync(join(outside,'safe.txt'),'utf8'),'untouched');
    assert.equal(JSON.parse(readFileSync(join(dir,'schema.json'),'utf8')).complete,true);
    mkdirSync(join(dir,'nested'));
    assert.equal(run(['--root',dir,'--schema','schema.json','--seed','1','--out','nested/new.json']).code,0);
    writeFileSync(join(dir,'ordinary.json'),'old');
    assert.equal(run(['--root',dir,'--schema','schema.json','--seed','1','--out','ordinary.json']).code,0);
    assert.equal(JSON.parse(readFileSync(join(dir,'ordinary.json'),'utf8')).cases.length,9);
  }finally{rmSync(dir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('field name and seed boundaries have both sides',()=>{
  const s=schema();s.fields[0].name='a'.repeat(32);
  assert.equal(generateFixtures(s,{seed:0xffffffff,now:()=>0,deadline:5000}).report.status,'pass');
  s.fields[0].name='a'.repeat(33);
  assert.equal(generateFixtures(s,{seed:0xffffffff,now:()=>0,deadline:5000}).report.status,'incomplete');
  assert.equal(generateFixtures(schema(),{seed:0x100000000,now:()=>0,deadline:5000}).report.status,'incomplete');
});

test('supported numeric and string constraint bounds have both sides',()=>{
  const s=schema();s.fields[0].minLength=0;s.fields[0].maxLength=32;s.fields[1].minimum= -1000;s.fields[1].maximum=1000;
  assert.equal(generateFixtures(s,{seed:1,now:()=>0,deadline:5000}).report.status,'pass');
  s.fields[0].maxLength=33;
  assert.equal(generateFixtures(s,{seed:1,now:()=>0,deadline:5000}).report.status,'incomplete');
  s.fields[0].maxLength=32;s.fields[1].minimum= -1001;
  assert.equal(generateFixtures(s,{seed:1,now:()=>0,deadline:5000}).report.status,'incomplete');
});

test('CLI passes injected deadline at exactly 5 seconds and times out at 5 seconds plus 1 ms',()=>{
  const dir=temp();try{
    writeFileSync(join(dir,'schema.json'),JSON.stringify(schema()));
    const clockAt=n=>{let calls=0;return()=>++calls===1?0:n;};
    assert.equal(run(['--root',dir,'--schema','schema.json','--seed','1','--out','at.json'],clockAt(5000)).code,0);
    const beyond=run(['--root',dir,'--schema','schema.json','--seed','1','--out','beyond.json'],clockAt(5001));
    assert.equal(beyond.code,2);assert.equal(beyond.report.findings[0].ruleId,'limit-exceeded');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('rule severity is behaviorally pinned',()=>{
  assert.deepEqual(RULES,{'constraint-conflict':'error','schema-invalid':'warning','input-unreadable':'warning','limit-exceeded':'warning'});
  assert.equal(generateFixtures({...schema(),complete:false},{seed:1,now:()=>0,deadline:5000}).report.status,'incomplete');
});
