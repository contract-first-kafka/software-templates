const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const jsonata = require('jsonata');
const {repositoryRoot: root} = require('../helpers/paths');
const template = YAML.parse(fs.readFileSync(path.join(root,'templates/component/template.yaml'),'utf8'));
const step = id => template.spec.steps.find(s => s.id === id);
test('only the Java DSL profile offers message selections and rejects incompatible submissions', async () => {
 const branches = template.spec.parameters[0].dependencies.implementationProfile.oneOf;
 expect(branches.filter(b=>b.properties.eventApis).map(b=>b.properties.implementationProfile.enum)).toEqual([['quarkus-camel-openapi']]);
 const resolve = jsonata(step('resolveBuildProfile').input.expression);
 for (const implementationProfile of ['nodejs-openapi','spring-boot-openapi','quarkus-camel-openapi-yaml'])
  await expect(resolve.evaluate({implementationProfile,quarkusBuildTarget:'jvm',events:[{}]})).rejects.toMatchObject({message: expect.stringContaining('Kafka contracts require')});
 expect(await resolve.evaluate({implementationProfile:'quarkus-camel-openapi',quarkusBuildTarget:'jvm',events:[{}]})).toBe('quarkus-jvm');
});
test('Kafka selection validates type and exact channel/message independent of operation direction', async()=>{
 const entity={metadata:{name:'orders',annotations:{'contract-first-idp.github.io/schema-registry-group-id':'orders','contract-first-idp.github.io/schema-registry-artifact-id':'events'}},spec:{type:'asyncapi'}};
 const messages=[{channel:'orders',message:'accepted',role:'publish'}];
 const apis=await jsonata(step('resolveEventMetadata').input.expression).evaluate({entities:[entity],selections:[{version:'latest',messages}],base:'https://registry/apis/registry/v3'});
 expect(apis[0].content_url).toContain('branch%3Dlatest');
 expect(apis[0].messages).toEqual(messages);
 const validate=jsonata(step('validateEventSelections').input.expression);
 expect(await validate.evaluate({apis,contracts:[{asyncapi:'3.1.0',servers:{kafka:{protocol:'kafka'}},channels:{orders:{messages:{accepted:{payload:{type:'object'}}}}}}]})).toEqual(apis);
 await expect(validate.evaluate({apis,contracts:[{asyncapi:'3.1.0',channels:{}}]})).rejects.toMatchObject({message: expect.stringContaining('Unknown channel/message')});
 entity.spec.type='openapi';
 await expect(jsonata(step('resolveEventMetadata').input.expression).evaluate({entities:[entity],selections:[{version:'latest',messages}]})).rejects.toMatchObject({message: expect.stringContaining('AsyncAPI entity')});
});
test('Component API relationships include only selected message roles, without duplicate API refs', () => {
 const nunjucks=require('nunjucks');
 const env=new nunjucks.Environment(null,{tags:{variableStart:'${{',variableEnd:'}}'}});
 const rendered=env.renderString(fs.readFileSync(path.join(root,'skeletons/component/base/catalog-info.yaml'),'utf8'),{values:{
  componentName:'mixed',implementsApi:true,apiRef:'api:default/rest',consumed_apis:[],
  event_apis:[{ref:'api:default/events',messages:[{role:'publish'},{role:'publish'},{role:'consume'}]}]
 }});
 const entity=YAML.parse(rendered);
 expect(entity.spec.providesApis).toEqual(['api:default/rest','api:default/events']);
 expect(entity.spec.consumesApis).toEqual(['api:default/events']);
});

const eventEntity = {metadata: {name: 'events', annotations: {
 'contract-first-idp.github.io/schema-registry-group-id': 'test',
 'contract-first-idp.github.io/schema-registry-artifact-id': 'events',
}}, spec: {type: 'asyncapi'}};
const contract = {
 asyncapi: '3.1.0', servers: {broker: {protocol: 'kafka'}},
 channels: {
  orders: {address: 'orders', messages: {accepted: {$ref: '#/components/messages/Accepted'}, rejected: {payload: {type: 'object'}}}},
  audit: {address: 'orders', messages: {recorded: {$ref: '#/components/messages/Accepted'}}},
 },
 components: {messages: {Accepted: {payload: {type: 'object'}}}},
 operations: {irrelevant: {action: 'receive', channel: {$ref: '#/channels/orders'}}},
};
async function eventApis(selection, doc = contract) {
 const apis = await jsonata(step('resolveEventMetadata').input.expression).evaluate({
  entities: [eventEntity], selections: [{version: 'latest', ...selection}], base: 'https://registry/apis/registry/v3',
 });
 const resolved = await jsonata(step('resolveEventSelections').input.expression).evaluate({apis, contracts: [doc]});
 return jsonata(step('validateEventSelections').input.expression).evaluate({apis: resolved, contracts: [doc]});
}
const explicit = role => [
 {channel: 'orders', message: 'accepted', role},
 {channel: 'orders', message: 'rejected', role},
 {channel: 'audit', message: 'recorded', role},
];
const renderEvents = event_apis => {
 const nunjucks = require('nunjucks');
 const env = new nunjucks.Environment(null, {autoescape: false, tags: {variableStart: '${{', variableEnd: '}}'}});
 return env.renderString(fs.readFileSync(path.join(root, 'skeletons/component/capabilities/kafka/src/main/resources/event-contracts.json'), 'utf8'), {values: {event_apis}});
};
test.each(['publish', 'consume'])('%s expands every channel/message without changing downstream output', async role => {
 const simple = await eventApis({role});
 const advanced = await eventApis({messages: explicit(role)});
 expect(simple[0].messages).toEqual(explicit(role));
 expect(simple).toEqual(advanced);
 expect(renderEvents(simple)).toBe(renderEvents(advanced));
 expect(JSON.parse(renderEvents(simple))).toEqual(simple);
});
test('Advanced overrides expansion, preserves mixed roles and REST forwarding, and accepts legacy input', async () => {
 const messages = [{channel:'orders',message:'accepted',role:'publish',restOperation:'submit'}, {channel:'audit',message:'recorded',role:'consume'}];
 expect(await eventApis({role:'consume',advanced:true,messages})).toEqual(await eventApis({messages}));
 expect((await eventApis({role:'publish',messages}))[0].messages).toEqual(messages);
});
test.each(['3.0.0','3.1.0'])('expands singleton and referenced channels for AsyncAPI %s', async asyncapi => {
 const doc = {...contract, asyncapi, channels: {alias: {$ref:'#/components/channels/shared'}}, components:{channels:{shared:{address:'orders',messages:{accepted:{payload:{type:'object'}}}}}}};
 expect((await eventApis({role:'consume'},doc))[0].messages).toEqual([{channel:'alias',message:'accepted',role:'consume'}]);
});
test.each([
 [{role:'both'}, contract, 'Component role'],
 [{role:'publish',advanced:true}, contract, 'Select at least'],
 [{role:'publish',messages:[]}, contract, 'Select at least'],
 [{messages:[{channel:'orders',message:'missing',role:'publish'}]},contract,'Unknown channel/message'],
 [{messages:[{channel:'missing',message:'accepted',role:'publish'}]},contract,'Unknown channel/message'],
 [{messages:[{channel:'orders',message:'accepted',role:'both'}]},contract,'Message role'],
 [{messages:[{channel:'orders',role:'publish'}]},contract,'Unknown channel/message'],
 [{role:'publish'},{...contract,asyncapi:'2.6.0'},'AsyncAPI 3.0.x or 3.1.x'],
 [{role:'consume'},{...contract,servers:{http:{protocol:'http'}}},'Kafka transport'],
 [{role:'publish'},{...contract,channels:{}},'Select at least'],
 [{role:'publish'},{...contract,channels:{orders:{messages:{bad:{payload:{schemaFormat:'application/xml'}}}}}},'Avro or JSON Schema'],
])('invalid selection or contract fails through the common validation: %j', async (selection, doc, error) => {
 await expect(eventApis(selection, doc)).rejects.toMatchObject({message:expect.stringContaining(error)});
});
test('no event selections leaves OpenAPI-only creation unchanged', async () => {
 const resolved = await jsonata(step('resolveEventSelections').input.expression).evaluate({apis:[],contracts:[]});
 expect(resolved).toEqual([]);
 expect(await jsonata(step('validateEventSelections').input.expression).evaluate({apis:resolved,contracts:[]})).toEqual([]);
});
test('native form offers publish/consume and hides explicit messages behind Advanced configuration', () => {
 const item = template.spec.parameters[0].dependencies.implementationProfile.oneOf[0].properties.eventApis.items;
 expect(item.properties.role.enum).toEqual(['publish','consume']);
 expect(item.properties.version.default).toBe('latest');
 expect(item.properties.apiRef['ui:field']).toBe('EntityPicker');
 expect(item.properties.messages).toBeUndefined();
 expect(item.dependencies.advanced.oneOf[1].properties.messages.items.properties.role.enum).toEqual(['publish','consume']);
 expect(step('validateEventSelections').input.data.apis).toContain('steps.resolveEventSelections.output.result');
});

test('turning Advanced off ignores stale hidden form selections', async () => {
 const messages = [{channel:'orders',message:'accepted',role:'consume'}];
 expect(await eventApis({role:'publish',advanced:false,messages})).toEqual(await eventApis({role:'publish'}));
});
