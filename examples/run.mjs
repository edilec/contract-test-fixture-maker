import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCli} from '../src/cli.mjs';
const which=process.argv[2];
if(!['passing','failing'].includes(which)){process.stderr.write('Usage: node examples/run.mjs passing|failing\n');process.exitCode=2;}
else{
  const root=mkdtempSync(join(tmpdir(),'fixture-maker-example-'));
  try{
    const source=fileURLToPath(new URL(`./${which}/schema.json`,import.meta.url));
    writeFileSync(join(root,'schema.json'),readFileSync(source));
    process.exitCode=runCli(['--root',root,'--schema','schema.json','--seed','7','--out','fixtures.json']);
  }finally{rmSync(root,{recursive:true,force:true});}
}
