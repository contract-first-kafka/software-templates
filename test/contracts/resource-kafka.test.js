const fs=require('fs');
const path=require('path');
const YAML=require('yaml');
const nunjucks=require('nunjucks');
const {repositoryRoot:root}=require('../helpers/paths');
test('Kafka uses the existing Resource repository and System lifecycle',()=>{
 const template=YAML.parse(fs.readFileSync(path.join(root,'templates/resource/template.yaml'),'utf8'));
 expect(template.spec.parameters[0].properties.profile.enum).toEqual(['postgresql','kafka']);
 const render=new nunjucks.Environment(null,{tags:{variableStart:'${{',variableEnd:'}}'}});
 const values={resourceName:'events',kafkaVersion:'4.2.0',replicaCount:1,storageClass:'',storageSize:'5Gi',environment:'dev'};
 const read=part=>YAML.parse(render.renderString(fs.readFileSync(path.join(root,'skeletons/resource/implementations/kafka/system-repo',part),'utf8'),{values}));
 expect(read('base/values.yaml')).toMatchObject({profile:'kafka',implementation:{path:'charts/resource/kafka'},storage:{deleteClaim:false}});
 expect(read('environment/${{ values.environment }}.yaml')).toEqual({profile:'kafka',resourceName:'events',storage:{size:'5Gi'}});
 expect(template.spec.steps.find(s=>s.id==='renderSystemEnvironment').each).toContain('environments.order');
});
