import {lstatSync,realpathSync,statSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
export class DestinationError extends Error{}
const inside=(root,path)=>{const rel=relative(root,path);return rel!=='..'&&!rel.startsWith('../')&&!isAbsolute(rel);};
export function assertWritableDestination(destination,{root,inputs}){
  const target=resolve(destination);let existing=null;
  try{existing=lstatSync(target);}catch(e){if(e.code!=='ENOENT')throw new DestinationError('Destination cannot be inspected.');}
  if(existing?.isSymbolicLink())throw new DestinationError('Destination is a symbolic link.');
  if(existing&&!existing.isFile())throw new DestinationError('Destination is not a regular file.');
  let parent;try{parent=realpathSync(dirname(target));}catch{throw new DestinationError('Destination parent is unavailable.');}
  if(!inside(realpathSync(root),parent))throw new DestinationError('Destination resolves outside the root.');
  if(existing)for(const input of inputs){
    let source;try{source=statSync(input);}catch{continue;}
    if(source.dev===existing.dev&&source.ino===existing.ino)throw new DestinationError('Destination aliases an input file.');
  }
  return target;
}
