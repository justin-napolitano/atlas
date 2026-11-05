import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const source=await readFile(new URL('../../src/islam_research/resources/reading-collection-v1.json',import.meta.url));
const target=new URL('../samples/data.js',import.meta.url);
const content='// Located collection; generated unchanged from resources/reading-collection-v1.json.\n'
  +'// SHA256 '+createHash('sha256').update(source).digest('hex')+'\n'
  +'export const collection='+source.toString('utf8').trim()+';\n';
if(process.argv.includes('--check')){
  if(await readFile(target,'utf8')!==content)throw new Error('Sample excerpts differ from the located collection. Run npm run refresh:samples.');
  console.log('Sample excerpts match the located collection exactly.');
}else await writeFile(target,content);
