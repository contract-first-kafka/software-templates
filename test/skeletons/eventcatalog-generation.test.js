const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const YAML=require('yaml');
const {repositoryRoot:root}=require('../helpers/paths');
const reference=path.resolve(root,'../developer-charts/test/fixtures/asyncapi/order-events.yaml');
// The working reference stays byte-for-byte unchanged. Mutations below are temporary fixtures only.
const source=fs.readFileSync(reference,'utf8');
let temp, inputs;
const read=file=>fs.readFileSync(path.join(temp,file),'utf8');
const write=(file,value)=>{fs.mkdirSync(path.dirname(path.join(temp,file)),{recursive:true});fs.writeFileSync(path.join(temp,file),typeof value==='string'?value:JSON.stringify(value,null,2));};
const list=dir=>fs.existsSync(path.join(temp,dir))?fs.readdirSync(path.join(temp,dir)):[];
const front=file=>YAML.parse(read(file).split('---')[1]);
const events=()=>list('events').map(id=>front(`events/${id}/index.md`));
function component(name,messages,version='latest',sha='a'.repeat(40)) {
  const c={id:'default--'+name,entity:{kind:'Component',metadata:{name,description:'Real Component'},spec:{owner:'group:default/owners'}},system:'default--orders',source:{url:'https://example.test/'+name+'.git',sha:'c'.repeat(40)},selections:messages?[{ref:'api:default/events',contract:'default--events',version,sourceSha:sha,messages}]:[]};inputs.components.push(c);return c;
}
beforeEach(()=>{
 temp=fs.mkdtempSync(path.join(os.tmpdir(),'eventcatalog-model-'));
 // Copy the generator beside the fixture dependency symlink for native ESM resolution.
 fs.mkdirSync(path.join(temp,'scripts'));fs.copyFileSync(path.join(root,'skeletons/domain/base/eventcatalog/scripts/generate.mjs'),path.join(temp,'scripts/generate.mjs'));
 fs.symlinkSync(path.join(root,'test/node_modules'),path.join(temp,'node_modules'),'dir');
 const entity=(kind,name)=>({kind,metadata:{name},spec:{owner:'group:default/owners'}});
 const revision={url:'https://example.test/events.git',revision:'main',sha:'a'.repeat(40),timestamp:200};
 inputs={domain:entity('Domain','shop'),organization:'example',resolved:[revision],systems:[{id:'default--orders',entity:entity('System','orders'),source:revision}],contracts:[{id:'default--events',ref:'api:default/events',entity:entity('API','events'),system:'default--orders',path:'.inputs/api/specification.yaml',source:revision}],components:[]};
 write('.inputs/api/specification.yaml',source);write('docs/index.mdx','# Authored architecture\nKeep it.');
});
afterEach(()=>fs.rmSync(temp,{recursive:true,force:true}));
// Execute the copied script: ESM resolves dependencies from its own location.
function generate(){write('.discovery.json',inputs);return execFileSync(process.execPath,['scripts/generate.mjs'],{cwd:temp,encoding:'utf8',stdio:'pipe'});}
test('independent reference contract produces native Domain, System, three Events and topics, zero Services',()=>{
 generate();expect(list('services')).toHaveLength(0);expect(events()).toHaveLength(3);expect(list('channels')).toHaveLength(3);
 expect(front('domains/default--shop/index.md').systems).toEqual([{id:'default--orders',version:'1.0.0'}]);
 const accepted=events().find(e=>e.name==='OrderAccepted');expect(accepted.channels).toHaveLength(2);
 expect(JSON.parse(read(`events/${accepted.id}/schema.avsc`)).type).toBe('record');
 expect(read(`events/${accepted.id}/headers.json`)).toContain('ce_specversion');expect(read(`events/${accepted.id}/examples.json`)).toContain('orderId');
 const shipment=events().find(e=>e.name==='ShipmentDispatched');const schema=JSON.parse(read(`events/${shipment.id}/schema.json`));
 expect(schema.properties.orderId.$ref).toMatch(/^#\/\$defs\//);expect(Object.values(schema.$defs)).toContainEqual({type:'string',minLength:1});
 expect(read(`public/contracts/default--events/${accepted.version}/specification.yaml`)).toBe(source);
 expect(list('docs/generated-contracts')).toHaveLength(1);expect(front('docs/generated-contracts/'+list('docs/generated-contracts')[0]).slug).toMatch(/^docs\/generated-contracts\//);expect(read('docs/index.mdx')).toBe('# Authored architecture\nKeep it.');
});
test('publisher, selective consumer, mixed roles and Component without events preserve exact directions and channels',()=>{
 component('publisher',[{channel:'orders',message:'accepted',role:'publish'},{channel:'audit',message:'accepted',role:'publish'}]);
 component('consumer',[{channel:'orders',message:'cancelled',role:'consume'}]);
 component('mixed',[{channel:'orders',message:'accepted',role:'publish'},{channel:'shipments',message:'dispatched',role:'consume'}]);component('rest');generate();
 const publisher=front('services/default--publisher/index.md');expect(publisher.sends).toHaveLength(1);expect(publisher.sends[0].to).toHaveLength(2);expect(publisher.receives).toEqual([]);
 const consumer=front('services/default--consumer/index.md');expect(consumer.receives).toHaveLength(1);expect(consumer.receives[0].id).toContain('OrderCancelled');expect(consumer.sends).toEqual([]);
 const mixed=front('services/default--mixed/index.md');expect(mixed.sends[0].id).toContain('OrderAccepted');expect(mixed.receives[0].id).toContain('ShipmentDispatched');
 expect(front('services/default--rest/index.md').sends).toEqual([]);
 expect(front('systems/default--orders/index.md').services).toHaveLength(4);
});
test('all channel declarations are generated even with no root operations, sharing one topic is deduplicated',()=>{
 const spec=YAML.parse(source);delete spec.operations;spec.channels.audit.address=spec.channels.orders.address;write('.inputs/api/specification.yaml',YAML.stringify(spec));generate();expect(events()).toHaveLength(3);expect(list('channels')).toHaveLength(2);expect(events().find(e=>e.name==='OrderAccepted').channels).toHaveLength(1);
});
test('pinned revisions retain distinct Event versions and resolve Component relationships to the selected source',()=>{
 const old=structuredClone(inputs.contracts[0]);old.source.sha='b'.repeat(40);old.source.timestamp=100;old.source.revision=old.source.sha;old.path='.inputs/old/specification.yaml';inputs.contracts.push(old);write(old.path,source);
 component('pinned',[{channel:'orders',message:'accepted',role:'consume'}],old.source.sha,old.source.sha);generate();
 const relation=front('services/default--pinned/index.md').receives[0];expect(relation.version).toContain(old.source.sha);
 expect(front(`events/${relation.id}/versioned/${relation.version}/index.md`)['x-source-revision']).toBe(old.source.sha);
 expect(front(`events/${relation.id}/index.md`)['x-source-revision']).toBe('a'.repeat(40));
 expect(require('semver').gt(front(`events/${relation.id}/index.md`).version,relation.version)).toBe(true);
});
test('metadata updates and removed Components reconcile without deleting independent contracts or authored docs',()=>{
 const c=component('consumer',[{channel:'orders',message:'accepted',role:'consume'}]);generate();c.entity.metadata.description='Changed description';generate();expect(front('services/default--consumer/index.md').summary).toBe('Changed description');
 inputs.components=[];generate();expect(list('services')).toEqual([]);expect(events()).toHaveLength(3);expect(front('systems/default--orders/index.md').services).toEqual([]);expect(read('docs/index.mdx')).toContain('Keep it.');
});
test('contract schema changes update Events without inventing Component relationships',()=>{
 generate();const spec=YAML.parse(source);spec.components.schemas.OrderAcceptedPayload.schema.fields.push({name:'region',type:'string'});write('.inputs/api/specification.yaml',YAML.stringify(spec));generate();
 const e=events().find(e=>e.name==='OrderAccepted');expect(read(`events/${e.id}/schema.avsc`)).toContain('region');expect(list('services')).toEqual([]);
});
test.each([
 [{channel:'missing',message:'accepted',role:'publish'},'has no missing/accepted'],
 [{channel:'orders',message:'accepted',role:'both'},'invalid role both'],
])('invalid relationships fail before replacing existing generated resources', (message,error)=>{
 generate();component('broken',[message]);expect(()=>generate()).toThrow(error);expect(events()).toHaveLength(3);expect(list('services')).toEqual([]);
});
