import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
const project = process.cwd(), root = path.resolve(project, '..');
const read = file => YAML.parse(fs.readFileSync(file, 'utf8'));
const git = (cwd, ...args) => execFileSync('git', ['-c', `safe.directory=${cwd}`, ...args], {cwd, encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const files = dir => fs.existsSync(dir) ? fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]) : [];
const domain = read(path.join(root,'catalog-info.yaml'));
if(domain.kind!=='Domain')throw Error('Expected Domain catalog-info.yaml');
const inputs = path.join(project,'.inputs');fs.rmSync(inputs,{recursive:true,force:true});fs.mkdirSync(inputs,{recursive:true});
const records=[], effective=[], services=[], systems=[];
function checkout(url, revision, key) {
  if(!/^https:\/\//.test(url))throw Error(`Expected HTTPS Git URL: ${url}`);
  if(!revision || revision.startsWith('-'))throw Error('Invalid Git revision');
  const dir=path.join(inputs,key);fs.mkdirSync(dir);
  git(dir,'init','--quiet');git(dir,'remote','add','origin',url);
  git(dir,'fetch','--quiet','--depth=1','origin',revision);git(dir,'checkout','--quiet','--detach','FETCH_HEAD');
  const sha=git(dir,'rev-parse','HEAD');records.push({url,revision,sha});return dir;
}
function include(file, name) {const value=fs.readFileSync(file,'utf8');effective.push([name,value]);return YAML.parse(value);}
const activationFiles=files(path.join(root,'systems')).filter(f=>f.endsWith(`/environments/${domain.spec.environments.build}.yaml`)).sort();
for(const file of activationFiles) {
  const activation=include(file,path.relative(root,file));
  const systemRoot=checkout(activation.repository.cloneUrl,activation.repository.revision,'system-'+activation.systemName);
  const system=include(path.join(systemRoot,'catalog-info.yaml'),activation.repository.cloneUrl+'/catalog-info.yaml');
  if(system.kind!=='System' || system.spec.domain.split('/').pop()!==domain.metadata.name)throw Error(`System ${activation.systemName} does not belong to this Domain`);
  systems.push({id:system.metadata.name,owner:system.spec.owner,repository:activation.repository.cloneUrl});
  const apiFiles=files(path.join(systemRoot,'apis')).filter(f=>path.relative(systemRoot,f).split(path.sep).length===3 && path.basename(f)==='values.yaml').sort();
  for(const [index,valuesFile] of apiFiles.entries()) {
    const values=include(valuesFile,activation.repository.cloneUrl+'/'+path.relative(systemRoot,valuesFile));
    const apiRoot=checkout(values.repository,values.revision || 'main',`api-${system.metadata.name}-${index}`);
    const api=include(path.join(apiRoot,'catalog-info.yaml'),values.repository+'/catalog-info.yaml');
    if(api.kind!=='API' || api.spec.type!=='asyncapi')continue;
    if(api.spec.system.split('/').pop()!==system.metadata.name)throw Error(`API ${api.metadata.name} has unexpected System`);
    const definition=api.spec.definition?.$text;
    if(typeof definition!=='string' || path.isAbsolute(definition) || definition.split('/').includes('..'))throw Error('Expected a repository-local API definition');
    const spec=path.join(apiRoot,definition);
    effective.push([values.repository+'/'+definition,fs.readFileSync(spec,'utf8')]); // Never parse or transform AsyncAPI here.
    const owner=api.spec.owner || system.spec.owner;
    services.push({id:`${system.metadata.name}--${api.metadata.name}`,name:`${system.metadata.name} / ${api.metadata.name} (contract)`,summary:`Independent API contract in System ${system.metadata.name}. Owner: ${owner}. Source: ${values.repository}. No deployed Component is implied.`,path:spec,owners:[owner.split('/').pop()]});
  }
}
const metadata=structuredClone(domain);delete metadata.spec.eventCatalog?.image;delete metadata.spec.eventCatalog?.inputDigest;
effective.push(['domain',JSON.stringify(metadata)]);
// Only Git-tracked project sources affect the image identity; generated outputs and
// the image-intent update itself do not cause a rebuild loop.
for(const file of git(root,'ls-files','eventcatalog').split('\n').filter(Boolean).sort())effective.push([file,fs.readFileSync(path.join(root,file),'utf8')]);
effective.sort(([a],[b])=>a.localeCompare(b));
const digest=crypto.createHash('sha256').update(JSON.stringify(effective)).digest('hex');
const result={domain:{id:domain.metadata.name,name:domain.metadata.title || domain.metadata.name,version:'1.0.0',owners:[domain.spec.owner.split('/').pop()]},organization:domain.metadata.annotations['contract-first-idp.github.io/domain-org'],systems,services,resolved:[{url:git(root,'remote','get-url','origin'),revision:'HEAD',sha:git(root,'rev-parse','HEAD')},...records],inputDigest:digest,changed:domain.spec.eventCatalog?.inputDigest!==digest};
fs.writeFileSync(path.join(project,'.discovery.json'),JSON.stringify(result,null,2));
fs.mkdirSync(path.join(project,'public'),{recursive:true});fs.writeFileSync(path.join(project,'public','build-inputs.json'),JSON.stringify({...result,services:result.services.map(({path:unused,...service})=>service)},null,2));
console.log(`Discovered ${systems.length} Systems, ${services.length} AsyncAPI contracts; input digest ${digest}; changed=${result.changed}`);
for(const record of records)console.log(`${record.url} @ ${record.revision} => ${record.sha}`);
