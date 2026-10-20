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
 expect(await validate.evaluate({apis,contracts:[{asyncapi:'3.1.0',channels:{orders:{messages:{accepted:{}}}}}]})).toEqual(apis);
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
