import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Parser} from '@asyncapi/parser';
import {AvroSchemaParser} from '@asyncapi/avro-schema-parser';
import eventcatalog from '@eventcatalog/sdk';
import YAML from 'yaml';

const project=process.cwd(), inputs=JSON.parse(fs.readFileSync('.discovery.json','utf8'));
const parser=new Parser();parser.registerSchemaParser(AvroSchemaParser());
const hash=value=>crypto.createHash('sha256').update(value).digest('hex').slice(0,16);
const escape=value=>String(value ?? '').replace(/[&<>{}]/g,c=>`&#${c.charCodeAt(0)};`);
const code=(value,language='json')=>'\n```'+language+'\n'+(typeof value==='string'?value:JSON.stringify(value,null,2))+'\n```\n';
const owner=entity=>(entity.spec.owner || inputs.domain.spec.owner).split('/').pop();
const pointer=r=>({id:r.id,version:r.version});
const resources={domains:[],systems:[],services:[],events:[],channels:[]}, documents=[];
const models=new Map(), owners=new Set();
function base(id,entity,source,version='1.0.0') {
  owners.add(owner(entity));
  return {id,name:entity.metadata.title || entity.metadata.name,version,summary:entity.metadata.description || '',owners:[owner(entity)],repository:{url:source.url},'x-cf-idp-entity':`${entity.kind.toLowerCase()}:${entity.metadata.namespace || 'default'}/${entity.metadata.name}`,'x-source-revision':source.sha,markdown:escape(entity.metadata.description || '')};
}
function sourceReader(filename) {
  const cache=new Map();
  const read=file=>{if(!cache.has(file))cache.set(file,YAML.parse(fs.readFileSync(file,'utf8')));return cache.get(file);};
  function resolve(value,file=filename,trail=[]) {
    if(!value?.$ref)return {value,file,key:null};
    const [relative,fragment='']=value.$ref.split('#');
    if(/^[a-z]+:/i.test(relative))throw Error(`Remote reference ${value.$ref} must be vendored in Git`);
    const target=relative?path.resolve(path.dirname(file),relative):file;
    const key=target+'#'+fragment;
    if(trail.includes(key))throw Error(`Circular structural reference ${key}`);
    const tokens=fragment ? fragment.replace(/^\//,'').split('/').map(x=>decodeURIComponent(x).replace(/~1/g,'/').replace(/~0/g,'~')):[];
    const found=tokens.reduce((v,k)=>v?.[k],read(target));
    if(found===undefined)throw Error(`Missing reference ${value.$ref} in ${file}`);
    const result=resolve(found,target,[...trail,key]);return {...result,key:result.key || key};
  }
  // Bundle JSON Schema references relative to the attached schema, retaining cycles as $refs.
  function bundle(value,file) {
    const defs={}, seen=new Map();
    function walk(node,origin) {
      if(Array.isArray(node))return node.map(n=>walk(n,origin));
      if(!node || typeof node!=='object')return node;
      if(node.$ref) {
        const target=resolve(node,origin);const key=target.key;
        if(!seen.has(key)) {const id='ref_'+hash(key.replace(path.dirname(filename),''));seen.set(key,id);defs[id]={};defs[id]=walk(target.value,target.file);}
        return {...Object.fromEntries(Object.entries(node).filter(([k])=>k!=='$ref').map(([k,v])=>[k,walk(v,origin)])),$ref:'#/$defs/'+seen.get(key)};
      }
      return Object.fromEntries(Object.entries(node).map(([k,v])=>[k,walk(v,origin)]));
    }
    const result=walk(value,file);return Object.keys(defs).length?{...result,$defs:{...result.$defs,...defs}}:result;
  }
  return {read,resolve,bundle};
}
for(const contract of inputs.contracts) {
  const filename=path.resolve(contract.path), reader=sourceReader(filename), raw=reader.read(filename);
  const {document,diagnostics}=await parser.parse(fs.readFileSync(filename,'utf8'),{source:filename});
  const errors=diagnostics.filter(d=>d.severity===0);
  if(!document || errors.length)throw Error(`${contract.ref}@${contract.source.revision}: ${errors.map(d=>d.message+' at '+d.path.join('/')).join('; ')}`);
  if(!/^3\.[01]\.\d+$/.test(raw.asyncapi))throw Error(`${contract.ref}: expected AsyncAPI 3.0 or 3.1`);
  const logical=String(raw.info.version);
  if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(logical))throw Error(`${contract.ref}: info.version must be a semantic version`);
  // Source revisions distinguish independent Git publications with an unchanged info.version.
  if(!Number.isSafeInteger(contract.source.timestamp) || contract.source.timestamp<0)throw Error(`${contract.ref}: missing Git commit timestamp for native version ordering`);
  const version=logical.split('+')[0]+(logical.includes('-')?'.':'-')+'git.'+contract.source.timestamp+'.'+contract.source.sha;
  const current=inputs.contracts.find(c=>c.id===contract.id)===contract;
  const docSlug=`generated-contracts/${contract.id}-${version}`;
  const repositoryRoot=path.resolve('.inputs',contract.path.split('/')[1]);
  const definition=contract.definition || path.relative(repositoryRoot,filename);
  const sourceUrl=contract.source.url.replace(/\.git$/,'')+'/blob/'+contract.source.sha+'/'+definition;
  const specUrl=`/contracts/${contract.id}/${version}/${definition}`;
  const model={contract,version,current,events:new Map(),channels:new Map(),selections:new Map(),docSlug,specUrl,filename,repositoryRoot,definition};
  for(const [channelKey,channelRef] of Object.entries(raw.channels || {})) {
    const {value:channel,file:channelFile}=reader.resolve(channelRef);
    if(typeof channel.address!=='string' || !channel.address)throw Error(`${contract.ref}: channel ${channelKey} has no topic address`);
    const servers=(channel.servers || Object.values(raw.servers || {})).map(s=>reader.resolve(s,channelFile).value);
    if(!servers.length || servers.some(s=>!['kafka','kafka-secure'].includes(s.protocol)))throw Error(`${contract.ref}: ${channelKey} must declare Kafka servers`);
    const channelId=contract.id+'--topic-'+hash(channel.address);
    if(!model.channels.has(channelId))model.channels.set(channelId,{id:channelId,name:channel.address,address:channel.address,version,protocols:['kafka'],owners:[owner(contract.entity)],repository:{url:contract.source.url},'x-channel-keys':[],markdown:`Kafka topic declared by [${escape(raw.info.title)}](/docs/custom/${docSlug}).`});
    const channelResource=model.channels.get(channelId);channelResource['x-channel-keys'].push(channelKey);
    for(const [messageKey,messageRef] of Object.entries(channel.messages || {})) {
      const resolved=reader.resolve(messageRef,channelFile), message=resolved.value;
      const canonical=resolved.key?resolved.key.replace(path.dirname(filename),''):JSON.stringify(['inline',channelKey,messageKey]);
      const eventId=contract.id+'--'+(resolved.key?.split('/').pop() || messageKey).replace(/[^a-zA-Z0-9_-]/g,'-')+'-'+hash(canonical);
      if(!model.events.has(eventId)) {
        const payload=reader.resolve(message.payload,resolved.file);
        if(!payload.value)throw Error(`${contract.ref}: ${channelKey}/${messageKey} has no payload`);
        const format=payload.value.schemaFormat || message.schemaFormat || 'application/schema+json';
        const avro=format.includes('avro');
        if(!avro && !/schema\+json|aai.asyncapi/.test(format))throw Error(`${contract.ref}: unsupported schema format ${format}`);
        const schema=reader.bundle(payload.value.schema ?? payload.value,payload.file);
        const headers=message.headers?reader.bundle(message.headers,resolved.file):undefined;
        const examples=reader.bundle(message.examples || [],resolved.file);
        model.events.set(eventId,{id:eventId,name:message.title || message.name || messageKey,version,summary:message.summary || '',owners:[owner(contract.entity)],channels:[],schemaPath:avro?'schema.avsc':'schema.json',repository:{url:contract.source.url},'x-contract-ref':contract.ref,'x-contract-version':logical,'x-source-revision':contract.source.sha,'x-schema-format':format,markdown:`${escape(message.description || message.summary || '')}\n\nContract: [${escape(raw.info.title)}](/docs/custom/${docSlug}) · [Authoritative source](${sourceUrl}) · [Original AsyncAPI](${specUrl})\n\n## Headers\n${headers?code(headers):'No headers declared.'}\n## Examples\n${code(examples)}`,schema,headers,examples});
      }
      const event=model.events.get(eventId);
      if(!event.channels.some(c=>c.id===channelId))event.channels.push(pointer(channelResource));
      model.selections.set(channelKey+'/'+messageKey,{event,channel:channelResource});
    }
  }
  if(!model.events.size)throw Error(`${contract.ref}: no channel/message declarations`);
  models.set(contract.id+'@'+contract.source.sha,model);
  documents.push({title:raw.info.title,summary:raw.info.description || 'Independent AsyncAPI contract',slug:'docs/'+docSlug,fileName:contract.id+'-'+version,markdown:`# ${escape(raw.info.title)}\n\n${escape(raw.info.description || '')}\n\nThis independent contract is not a Service. Its operations do not declare Component roles.\n\nLogical version: ${escape(logical)}. Exact Git revision: ${contract.source.sha}. Owner: ${escape(owner(contract.entity))}.\n\n[Authoritative specification](${sourceUrl}) · [Download original AsyncAPI](${specUrl}) · [System](/docs/systems/${contract.system}/1.0.0)\n\n## Events\n${[...model.events.values()].map(e=>`- [${escape(e.name)}](/docs/events/${e.id}/${e.version})`).join('\n')}\n\n## Kafka topics\n${[...model.channels.values()].map(c=>`- [${escape(c.address)}](/docs/channels/${c.id}/${c.version})`).join('\n')}\n\n## Original specification\n${code(fs.readFileSync(filename,'utf8'),'yaml')}`});
}
for(const component of inputs.components) {
  const service={...base(component.id,component.entity,component.source),sends:[],receives:[],'x-event-contracts':component.selections};
  for(const selection of component.selections) {
    const model=models.get(selection.contract+'@'+selection.sourceSha);
    if(!model)throw Error(`${component.id}: unresolved contract ${selection.ref}@${selection.version}`);
    if(!Array.isArray(selection.messages) || !selection.messages.length)throw Error(`${component.id}: empty message selection for ${selection.ref}`);
    for(const message of selection.messages) {
      if(!['publish','consume'].includes(message.role))throw Error(`${component.id}: invalid role ${message.role}`);
      const match=model.selections.get(message.channel+'/'+message.message);
      if(!match)throw Error(`${component.id}: ${selection.ref}@${selection.version} has no ${message.channel}/${message.message}`);
      const role=message.role==='publish'?'sends':'receives', direction=role==='sends'?'to':'from';
      let relation=service[role].find(r=>r.id===match.event.id && r.version===match.event.version);
      if(!relation){relation={...pointer(match.event),[direction]:[]};service[role].push(relation);}
      if(!relation[direction].some(c=>c.id===match.channel.id))relation[direction].push(pointer(match.channel));
    }
  }
  service.markdown+=`\n\n## Declared event contracts\n${component.selections.length?component.selections.map(s=>`- ${escape(s.ref)}: selected ${escape(s.version)}, source ${s.sourceSha}`).join('\n'):'No Kafka contracts declared.'}\n\nRelationships are taken from this Component’s Git-authored event-contracts.json, independently of AsyncAPI operation actions.`;
  resources.services.push(service);
}
for(const system of inputs.systems) {
  const contracts=[...models.values()].filter(m=>m.contract.system===system.id);
  resources.systems.push({...base(system.id,system.entity,system.source),services:inputs.components.filter(c=>c.system===system.id).map(c=>({id:c.id,version:'1.0.0'})),resourceGroups:[{title:'Independent event contracts',items:contracts.flatMap(m=>[...m.events.values()].map(e=>({...pointer(e),type:'event'})))}],markdown:escape(system.entity.metadata.description || '')+'\n\n## Contracts\n'+contracts.map(m=>`- [${escape(m.contract.entity.metadata.name)} (${m.version})](/docs/custom/${m.docSlug})`).join('\n')});
}
const domainId=(inputs.domain.metadata.namespace || 'default')+'--'+inputs.domain.metadata.name;
resources.domains.push({...base(domainId,inputs.domain,inputs.resolved[0]),systems:resources.systems.map(pointer),markdown:fs.readFileSync('docs/index.mdx','utf8').replace(/^---[\s\S]*?---\s*/,'')});
for(const model of models.values()) {
  resources.events.push(...model.events.values());resources.channels.push(...model.channels.values());
}
// Validate and assemble everything before replacing generated content; authored docs never move.
const staging=path.join(project,'.generation');fs.rmSync(staging,{recursive:true,force:true});fs.mkdirSync(staging);
const sdk=eventcatalog(staging);
for(const [collection,method] of [['domains','writeDomain'],['systems','writeSystem'],['services','writeService'],['events','writeEvent'],['channels','writeChannel']]) {
  for(const resource of resources[collection]) {
    const model=[...models.values()].find(m=>m.version===resource.version && (m.events.has(resource.id) || m.channels.has(resource.id)));
    const resourcePath=resource.id+(model && !model.current?'/versioned/'+resource.version:'');
    const {schema,headers,examples,...native}=resource;
    await sdk[method](native,{path:resourcePath,format:'md',override:false});
    if(schema) {
      const directory=path.join(staging,collection,resourcePath);
      fs.writeFileSync(path.join(directory,resource.schemaPath),JSON.stringify(schema,null,2)+'\n');
      fs.writeFileSync(path.join(directory,'examples.json'),JSON.stringify(examples,null,2)+'\n');
      if(headers)fs.writeFileSync(path.join(directory,'headers.json'),JSON.stringify(headers,null,2)+'\n');
    }
  }
}
for(const id of [...owners].sort())await sdk.writeTeam({id,name:id,markdown:'Ownership declared in CF-IDP catalog metadata.'});
for(const doc of documents)await sdk.writeCustomDoc(doc,{path:'generated-contracts'});
for(const collection of ['domains','systems','services','events','channels','teams','commands','queries']) {
  fs.rmSync(collection,{recursive:true,force:true});
  if(fs.existsSync(path.join(staging,collection)))fs.renameSync(path.join(staging,collection),collection);
}
fs.rmSync('docs/generated-contracts',{recursive:true,force:true});
if(fs.existsSync(path.join(staging,'docs/generated-contracts')))fs.renameSync(path.join(staging,'docs/generated-contracts'),'docs/generated-contracts');
fs.rmSync('public/contracts',{recursive:true,force:true});
for(const model of models.values()) {
  const directory=path.join('public/contracts',model.contract.id,model.version);fs.mkdirSync(directory,{recursive:true});
  for(const file of model.contract.files || [model.definition]) {
    const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(model.repositoryRoot,file),target);
  }
}
fs.rmSync(staging,{recursive:true,force:true});
console.log(`Generated ${resources.domains.length} Domains, ${resources.systems.length} Systems, ${resources.services.length} real Services, ${resources.events.length} Event versions, ${resources.channels.length} Channel versions`);
