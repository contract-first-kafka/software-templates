const fs=require('node:fs');const path=require('node:path');const YAML=require('yaml');
const {repositoryRoot:root}=require('../helpers/paths');
const template=YAML.parse(fs.readFileSync(path.join(root,'templates/asyncapi/template.yaml'),'utf8'));
test('AsyncAPI stages the complete authoritative textarea input and uses catalog ownership',()=>{
 const parameters=template.spec.parameters[0];
 expect(parameters.required).toContain('specification');
 expect(parameters.properties.specification['ui:widget']).toBe('textarea');
 const steps=new Map(template.spec.steps.map(s=>[s.id,s]));
 expect(steps.get('writeSpecification').input).toMatchObject({content:'${{ parameters.specification }}',preserveFormatting:true});
 expect(steps.get('renderCatalog').input.values.owner).toBe('${{ parameters.owner }}');
 expect(steps.has('systemPr')).toBe(true);expect(steps.has('webhook')).toBe(true);
});
