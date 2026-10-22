const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const YAML = require('yaml');
const {repositoryRoot: root} = require('../helpers/paths');

test('Git discovery follows registrations, keeps portable paths and skips unchanged image intent', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-discovery-'));
  const git = (cwd,...args) => execFileSync('git',args,{cwd,stdio:'pipe',encoding:'utf8'}).trim();
  function write(cwd,name,value) {
    fs.mkdirSync(path.dirname(path.join(cwd,name)),{recursive:true});
    fs.writeFileSync(path.join(cwd,name), typeof value==='string'?value:YAML.stringify(value));
  }
  function init(name) {
    const dir=path.join(temp,name);fs.mkdirSync(dir);git(dir,'init','-b','main');
    git(dir,'config','user.email','test@example.invalid');git(dir,'config','user.name','Test');return dir;
  }
  function commit(dir) {git(dir,'add','.');git(dir,'commit','-m','fixture');}
  try {
    const api=init('api.git');
    write(api,'catalog-info.yaml',{kind:'API',metadata:{name:'events'},spec:{type:'asyncapi',system:'system:default/orders',owner:'group:default/owners',definition:{$text:'./specification.yaml'}}});
    // Discovery tracks local references but preserves the original specification bytes.
    write(api,'specification.yaml','opaque specification bytes: build-time parser owns parsing');commit(api);
    const system=init('system.git');
    write(system,'catalog-info.yaml',{kind:'System',metadata:{name:'orders'},spec:{domain:'domain:default/shop',owner:'group:default/owners'}});
    write(system,'apis/events/values.yaml',{repository:'https://example.test/api.git',revision:'main'});commit(system);
    const domain=init('domain');git(domain,'remote','add','origin','https://example.test/domain.git');
    const metadata={kind:'Domain',metadata:{name:'shop',annotations:{'contract-first-idp.github.io/domain-org':'example'}},spec:{owner:'group:default/owners',environments:{build:'dev'},eventCatalog:{enabled:true}}};
    write(domain,'catalog-info.yaml',metadata);
    write(domain,'eventcatalog/scripts/discover.mjs',fs.readFileSync(path.join(root,'skeletons/domain/base/eventcatalog/scripts/discover.mjs'),'utf8'));
    write(domain,'eventcatalog/docs/index.mdx','Authored architecture must survive');
    write(domain,'eventcatalog/.gitignore','node_modules\n.inputs/\n.discovery.json\npublic/\n');commit(domain);
    const project=path.join(domain,'eventcatalog');fs.symlinkSync(path.join(root,'test/node_modules'),path.join(project,'node_modules'),'dir');
    const env={...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`url.file://${temp}/.insteadOf`,GIT_CONFIG_VALUE_0:'https://example.test/'};
    const discover=()=>{execFileSync(process.execPath,['scripts/discover.mjs'],{cwd:project,env,stdio:'pipe'});return JSON.parse(fs.readFileSync(path.join(project,'.discovery.json')));};
    expect(discover().contracts).toHaveLength(0);
    write(domain,'systems/orders/environments/dev.yaml',{systemName:'orders',repository:{cloneUrl:'https://example.test/system.git',revision:'main'}});commit(domain);
    const first=discover();expect(first.systems[0].id).toBe('default--orders');expect(first.contracts).toHaveLength(1);
    expect(path.isAbsolute(first.contracts[0].path)).toBe(false);
    expect(fs.readFileSync(path.join(project,first.contracts[0].path),'utf8')).toContain('opaque specification bytes');
    expect(first.resolved.find(x=>x.url==='https://example.test/api.git').sha).toBe(git(api,'rev-parse','HEAD'));
    metadata.spec.eventCatalog.inputDigest=first.inputDigest;metadata.spec.eventCatalog.image='registry/image@sha256:'+ 'a'.repeat(64);write(domain,'catalog-info.yaml',metadata);
    expect(discover().changed).toBe(false);
    write(api,'specification.yaml','updated opaque contract bytes');commit(api);expect(discover().changed).toBe(true);
    const component=init('component.git');
    const componentEntity={kind:'Component',metadata:{name:'processor'},spec:{system:'system:default/orders',owner:'group:default/owners',consumesApis:['api:default/events']}};
    write(component,'catalog-info.yaml',componentEntity);
    const selections=[{ref:'api:default/events',version:'latest',messages:[{channel:'orders',message:'accepted',role:'consume'}]}];
    write(component,'src/main/resources/event-contracts.json',JSON.stringify(selections));write(component,'src/App.java','// initial application');commit(component);
    write(system,'components/processor/values.yaml',{build:{repository:'https://example.test/component.git',revision:'main'}});commit(system);
    const withComponent=discover();expect(withComponent.components).toHaveLength(1);expect(withComponent.components[0].selections[0].sourceSha).toBe(git(api,'rev-parse','HEAD'));
    write(component,'src/App.java','// unrelated application edit');commit(component);expect(discover().inputDigest).toBe(withComponent.inputDigest);
    componentEntity.metadata.description='New architecture description';write(component,'catalog-info.yaml',componentEntity);commit(component);expect(discover().inputDigest).not.toBe(withComponent.inputDigest);
    const pinned=git(api,'rev-parse','HEAD');selections[0].version=pinned;write(component,'src/main/resources/event-contracts.json',JSON.stringify(selections));commit(component);
    write(api,'specification.yaml','newer contract: latest');commit(api);const versions=discover();expect(versions.contracts).toHaveLength(2);expect(versions.components[0].selections[0].sourceSha).toBe(pinned);
    selections[0].version='nonexistent-tag';write(component,'src/main/resources/event-contracts.json',JSON.stringify(selections));commit(component);expect(()=>discover()).toThrow('Cannot resolve');
    fs.rmSync(path.join(system,'components'),{recursive:true});commit(system);expect(discover().components).toHaveLength(0);expect(discover().contracts).toHaveLength(1);
    expect(fs.readFileSync(path.join(project,'docs/index.mdx'),'utf8')).toBe('Authored architecture must survive');
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('server runtime packaging includes MCP contract files and notices but excludes build inputs and credentials', () => {
  const source = path.join(root, 'skeletons/domain/base/eventcatalog');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-runtime-'));
  try {
    for (const file of ['dist/server/entry.mjs', 'dist/client/generated/services/orders/specification.yaml',
      '.discovery.json', 'docs/index.mdx', 'domains/demo/services/orders/specification.yaml',
      '.astro/eventcatalog/.eventcatalog/fields.db', '.inputs/repo/.git/config', '.env',
      'node_modules/@eventcatalog/core/LICENSE', 'node_modules/@eventcatalog/core/NOTICE',
      'node_modules/@asyncapi/parser/LICENSE', 'node_modules/@asyncapi/avro-schema-parser/LICENSE', 'node_modules/@eventcatalog/sdk/LICENSE']) {
      fs.mkdirSync(path.dirname(path.join(temp, file)), {recursive: true});
      fs.writeFileSync(path.join(temp, file), 'fixture');
    }
    for (const file of ['package.json', 'package-lock.json', 'eventcatalog.config.js'])
      fs.copyFileSync(path.join(source, file), path.join(temp, file));
    execFileSync(process.execPath, [path.join(source, 'scripts/package-runtime.mjs')], {cwd: temp});
    for (const file of ['.discovery.json', 'docs/index.mdx', 'domains/demo/services/orders/specification.yaml',
      '.astro/eventcatalog/.eventcatalog/fields.db', 'dist/client/LICENSES/EventCatalog.txt',
      'dist/client/LICENSES/EventCatalog-NOTICE.txt', 'dist/client/LICENSES/AsyncAPI-parser.txt'])
      expect(fs.existsSync(path.join(temp, '.runtime', file))).toBe(true);
    for (const file of ['.inputs', '.env', 'node_modules', '.git'])
      expect(fs.existsSync(path.join(temp, '.runtime', file))).toBe(false);
    expect(fs.readFileSync(path.join(source, 'eventcatalog.config.js'), 'utf8')).toContain('chat: {enabled: false}');
    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
    expect(pkg.dependencies).toEqual({'@eventcatalog/core': '5.4.1'});
    expect(pkg.devDependencies['@eventcatalog/generator-asyncapi']).toBeUndefined();
    expect(pkg.devDependencies['@eventcatalog/sdk']).toBe('2.31.2');
    expect(fs.readFileSync(path.join(source, 'eventcatalog.config.js'), 'utf8')).toContain("output: 'server'");
    expect(fs.readFileSync(path.join(source, 'Dockerfile'), 'utf8')).toContain('ln -s /opt/app-root/src/dist/client/generated /generated');
    expect(fs.readFileSync(path.join(source, '.dockerignore'), 'utf8')).toContain('!.runtime/**');
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});
