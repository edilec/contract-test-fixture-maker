import {readFileSync,writeFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {generateFixtures,incompleteReport,LIMITS} from './index.mjs';
import {inspectJsonKeys} from './json-keys.mjs';
import {assertWritableDestination,DestinationError} from './write-guard.mjs';
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const inside=(root,path)=>{const rel=relative(root,path);return rel!=='..'&&!rel.startsWith('../')&&!isAbsolute(rel);};
const safePath=x=>typeof x==='string'&&x.length>0&&!isAbsolute(x)&&!x.split('/').some(y=>y==='.'||y==='..'||!y)&&!/[\u0000-\u001f\u007f-\u009f\\\p{Cf}]/u.test(x);
export function runCli(args,{stdout=process.stdout,stderr=process.stderr,now=Date.now}={}){
  const invalid=msg=>{stderr.write(`${msg}\n`);return 2;};
  if(args.length===1&&args[0]==='--help'){stderr.write('Usage: --root DIR --schema FILE --seed UINT32 --out FILE\n');return 0;}
  if(args.length!==8)return invalid('Usage: --root DIR --schema FILE --seed UINT32 --out FILE');
  const flags=new Map();for(let i=0;i<args.length;i+=2){if(!['--root','--schema','--seed','--out'].includes(args[i])||flags.has(args[i])||!args[i+1])return invalid('Invalid or duplicate option');flags.set(args[i],args[i+1]);}
  if(flags.size!==4||!/^\d+$/u.test(flags.get('--seed')))return invalid('Invalid options or seed');
  const seed=Number(flags.get('--seed'));if(!Number.isSafeInteger(seed)||seed>0xffffffff)return invalid('Seed exceeds uint32 range');
  let root;try{root=realpathSync(flags.get('--root'));if(!statSync(root).isDirectory())return invalid('Root must be a directory');}catch{return invalid('Invalid root directory');}
  if(!safePath(flags.get('--schema'))||!safePath(flags.get('--out')))return invalid('Input and destination paths must be relative and confined');
  const schemaPath=resolve(root,flags.get('--schema')),outPath=resolve(root,flags.get('--out'));
  if(!inside(root,schemaPath)||!inside(root,outPath))return invalid('Path escapes root');
  let actual;try{actual=realpathSync(schemaPath);if(!inside(root,actual))return invalid('Input path escapes root');}catch(e){if(e.message==='Input path escapes root')return invalid(e.message);if(e.code!=='ENOENT')return invalid('Input path could not be resolved');actual=schemaPath;}
  let result;
  try{
    const bytes=readFileSync(actual);
    if(bytes.length>LIMITS.schemaBytes)result={report:incompleteReport('limit-exceeded','Schema byte limit exceeded.'),artifact:null};
    else{
      const raw=decode(bytes),schema=JSON.parse(raw),problem=inspectJsonKeys(raw,LIMITS.depth);
      result=problem?{report:incompleteReport(problem==='depth'?'limit-exceeded':'schema-invalid',problem==='depth'?'Schema JSON depth limit exceeded.':'Schema contains duplicate JSON keys.'),artifact:null}:generateFixtures(schema,{seed,now,deadline:now()+LIMITS.milliseconds});
    }
  }catch{result={report:incompleteReport('input-unreadable','Schema input could not be read, decoded, or parsed.'),artifact:null};}
  if(result.artifact){
    try{const target=assertWritableDestination(outPath,{root,inputs:[actual]});writeFileSync(target,JSON.stringify(result.artifact)+'\n',{flag:'w'});}
    catch(error){return invalid(error instanceof DestinationError?error.message:'Destination could not be safely written');}
  }
  stdout.write(`${JSON.stringify(result.report)}\n`);
  stderr.write(`Generated ${result.report.summary.cases} fixture case(s); status ${result.report.status}.\n`);
  return result.report.status==='pass'?0:result.report.status==='fail'?1:2;
}
