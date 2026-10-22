import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';

const project = process.cwd(), root = path.resolve(project, '..');
const git = (cwd, ...args) => execFileSync('git', ['-c', `safe.directory=${cwd}`, ...args], {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
const files = dir => fs.existsSync(dir) ? fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]).sort() : [];
const read = file => YAML.parse(fs.readFileSync(file,'utf8'));
const ref = (value, kind) => {
  if (typeof value !== 'string' || !value) throw Error(`Missing ${kind} entity reference`);
  return `${value.includes(':') ? '' : kind+':'}${value.includes('/') ? value : 'default/'+value}`.toLowerCase();
};
const identity = entity => `${entity.metadata.namespace || 'default'}--${entity.metadata.name}`;
const domain = read(path.join(root,'catalog-info.yaml'));
if (domain.kind !== 'Domain') throw Error('Expected Domain catalog-info.yaml');
const inputs = path.join(project,'.inputs');
fs.rmSync(inputs,{recursive:true,force:true});fs.mkdirSync(inputs,{recursive:true});
const resolved=[], effective=new Map(), contracts=[], components=[], systems=[], checkouts=new Map();
function include(file, name) {
  const value=fs.readFileSync(file,'utf8');effective.set(name,value);return YAML.parse(value);
}
function checkout(url, revision) {
  if (!/^https:\/\/[^/@]+\/[^?#]+$/.test(url) || !revision || revision.startsWith('-')) throw Error(`Invalid Git source ${url} @ ${revision}`);
  const key=url+'@'+revision;
  if (checkouts.has(key)) return checkouts.get(key);
  const dir=path.join(inputs,String(checkouts.size));fs.mkdirSync(dir);
  try {
    git(dir,'init','--quiet');git(dir,'remote','add','origin',url);
    git(dir,'fetch','--quiet','--depth=1','origin',revision);git(dir,'checkout','--quiet','--detach','FETCH_HEAD');
  } catch {throw Error(`Cannot resolve ${url} @ ${revision}; pinned contract versions must identify a published Git commit or tag`);}
  const record={url,revision,sha:git(dir,'rev-parse','HEAD')};resolved.push(record);
  const result={dir,...record};checkouts.set(key,result);return result;
}
function membership(entity, kind, parent, parentKind) {
  if (entity.kind !== kind || ref(entity.spec[parentKind],parentKind) !== ref(`${parent.metadata.namespace || 'default'}/${parent.metadata.name}`,parentKind))
    throw Error(`${kind} ${entity.metadata?.name} has unexpected ${parentKind} membership`);
}
function contract(source, system, expectedRef, selectedVersion='latest') {
  const api=include(path.join(source.dir,'catalog-info.yaml'),source.url+'@'+source.revision+'/catalog-info.yaml');
  membership(api,'API',system,'system');
  const apiRef=ref(`${api.metadata.namespace || 'default'}/${api.metadata.name}`,'api');
  if (expectedRef && apiRef!==expectedRef) throw Error(`Contract ${source.url} changed identity: expected ${expectedRef}, found ${apiRef}`);
  if (api.spec.type!=='asyncapi') return null;
  const existing=contracts.find(c=>c.ref===apiRef && c.source.sha===source.sha);
  if (existing) return existing;
  const definition=api.spec.definition?.$text;
  if (typeof definition!=='string' || path.isAbsolute(definition) || definition.split('/').includes('..')) throw Error(`${apiRef}: expected repository-local specification`);
  const spec=path.join(source.dir,definition);
  // Track specification inputs, including repository-local schema references. Never rewrite the contract.
  const visited=new Set();
  function track(file) {
    const absolute=path.resolve(file);
    if (!absolute.startsWith(source.dir+path.sep)) throw Error(`${apiRef}: schema reference escapes repository`);
    if(visited.has(absolute))return;visited.add(absolute);
    const raw=include(absolute,source.url+'@'+source.revision+'/'+path.relative(source.dir,absolute));
    function walk(value) {
      if(!value || typeof value!=='object')return;
      if(typeof value.$ref==='string' && !value.$ref.startsWith('#')) {
        const external=value.$ref.split('#')[0];
        if (/^[a-z]+:/i.test(external)) throw Error(`${apiRef}: remote schema reference ${external} is not an immutable Git input; vendor it in the contract repository`);
        track(path.resolve(path.dirname(absolute),external));
      }
      Object.values(value).forEach(walk);
    }
    walk(raw);
  }
  track(spec);
  const result={id:identity(api),ref:apiRef,entity:api,system:identity(system),path:path.relative(project,spec),definition:path.relative(source.dir,spec),files:[...visited].map(f=>path.relative(source.dir,f)).sort(),source:{url:source.url,revision:source.revision,sha:source.sha},selectedVersion};
  effective.set(source.url+'@'+source.revision+'/resolved-contract-revision',source.sha);
  contracts.push(result);return result;
}
const activations=files(path.join(root,'systems')).filter(f=>f.endsWith(`/environments/${domain.spec.environments.build}.yaml`));
for(const file of activations) {
  const activation=include(file,path.relative(root,file));
  const source=checkout(activation.repository.cloneUrl,activation.repository.revision);
  const system=include(path.join(source.dir,'catalog-info.yaml'),source.url+'/catalog-info.yaml');
  membership(system,'System',domain,'domain');
  if(systems.some(s=>s.id===identity(system)))throw Error(`Duplicate activated System ${system.metadata.name}`);
  systems.push({id:identity(system),entity:system,source:{url:source.url,revision:source.revision,sha:source.sha}});
  const registrations=kind=>files(path.join(source.dir,kind)).filter(f=>path.relative(source.dir,f).split(path.sep).length===3 && path.basename(f)==='values.yaml');
  for(const f of registrations('apis')) {
    const values=include(f,source.url+'/'+path.relative(source.dir,f));
    const apiSource=checkout(values.repository,values.revision || 'main');
    contract(apiSource,system);
  }
  for(const f of registrations('components')) {
    const values=include(f,source.url+'/'+path.relative(source.dir,f));
    if(!values.build?.repository)throw Error(`${f}: Component registration is missing build.repository`);
    const componentSource=checkout(values.build.repository,values.build.revision || 'main');
    const entity=include(path.join(componentSource.dir,'catalog-info.yaml'),componentSource.url+'/catalog-info.yaml');
    membership(entity,'Component',system,'system');
    const selectionFile=path.join(componentSource.dir,'src/main/resources/event-contracts.json');
    const selections=fs.existsSync(selectionFile)?include(selectionFile,componentSource.url+'/src/main/resources/event-contracts.json'):[];
    if(!Array.isArray(selections))throw Error(`${entity.metadata.name}: event-contracts.json must contain an array`);
    for(const declared of [...(entity.spec.providesApis || []),...(entity.spec.consumesApis || [])]) {
      const apiRef=ref(declared,'api');
      if(contracts.some(c=>c.ref===apiRef) && !selections.some(s=>ref(s.ref,'api')===apiRef))throw Error(`${entity.metadata.name}: ${apiRef} is declared in catalog-info.yaml but missing from event-contracts.json`);
    }
    const selected=[];
    for(const selection of selections) {
      const apiRef=ref(selection.ref,'api');
      const current=contracts.find(c=>c.ref===apiRef && c.system===identity(system));
      if(!current)throw Error(`${entity.metadata.name}: ${apiRef} is not a registered AsyncAPI in System ${system.metadata.name}`);
      if(typeof selection.version!=='string' || !selection.version)throw Error(`${entity.metadata.name}: missing version for ${apiRef}`);
      const chosen=selection.version==='latest'?current:contract(checkout(current.source.url,selection.version),system,apiRef,selection.version);
      if(!chosen)throw Error(`${apiRef}@${selection.version}: not an AsyncAPI contract`);
      for(const role of ['publish','consume'])if(selection.messages?.some(m=>m.role===role)) {
        const declared=(entity.spec[role==='publish'?'providesApis':'consumesApis'] || []).map(r=>ref(r,'api'));
        if(!declared.includes(apiRef))throw Error(`${entity.metadata.name}: ${role} selection for ${apiRef} is absent from catalog-info.yaml API relationships`);
      }
      selected.push({...selection,ref:apiRef,contract:chosen.id,sourceSha:chosen.source.sha});
    }
    if(components.some(c=>c.id===identity(entity)))throw Error(`Duplicate Component identity ${entity.metadata.name}`);
    components.push({id:identity(entity),entity,system:identity(system),selections:selected,source:{url:componentSource.url,revision:componentSource.revision,sha:componentSource.sha}});
  }
}
const metadata=structuredClone(domain);delete metadata.spec.eventCatalog?.image;delete metadata.spec.eventCatalog?.inputDigest;
effective.set('domain',JSON.stringify(metadata));
for(const file of git(root,'ls-files','eventcatalog').split('\n').filter(Boolean).sort())effective.set(file,fs.readFileSync(path.join(root,file),'utf8'));
const inputDigest=crypto.createHash('sha256').update(JSON.stringify([...effective].sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
const result={domain:metadata,organization:domain.metadata.annotations['contract-first-idp.github.io/domain-org'],systems,contracts,components,resolved:[{url:git(root,'remote','get-url','origin'),revision:'HEAD',sha:git(root,'rev-parse','HEAD')},...resolved],inputDigest,changed:domain.spec.eventCatalog?.inputDigest!==inputDigest};
fs.writeFileSync('.discovery.json',JSON.stringify(result,null,2));
fs.mkdirSync('public',{recursive:true});fs.writeFileSync('public/build-inputs.json',JSON.stringify({...result,contracts:contracts.map(({path:unused,...c})=>c)},null,2));
console.log(`Discovered ${systems.length} Systems, ${contracts.length} contract revisions, ${components.length} Components; input digest ${inputDigest}; changed=${result.changed}`);
