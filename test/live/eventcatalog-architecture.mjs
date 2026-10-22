// Opt-in real core build regression: requires an installed Domain project with .discovery.json.
// Usage: node test/live/eventcatalog-architecture.mjs /path/to/eventcatalog
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
const project=path.resolve(process.argv[2]);
const run=script=>execFileSync('npm',['run',script],{cwd:project,stdio:'inherit'});
function snapshot(root) {
 const records={};
 function walk(directory) {
  if(!fs.existsSync(directory))return;
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
   const file=path.join(directory,entry.name);
   if(entry.isDirectory())walk(file);
   else if(/^index\.mdx?$/.test(entry.name))records[path.relative(root,file)]=YAML.parse(fs.readFileSync(file,'utf8').split('---')[1]);
  }
 }
 for(const collection of ['domains','systems','services','events','channels'])walk(path.join(root,collection));
 return records;
}
run('generate');const expected=snapshot(project);assert.ok(Object.keys(expected).length>0);
run('build');assert.deepEqual(snapshot(project),expected,'Core build changed native architecture declarations');
assert.deepEqual(snapshot(path.join(project,'.runtime')),expected,'Runtime packaging changed native architecture declarations');
console.log('Real EventCatalog build and runtime packaging preserve every native resource and exact channel selection.');
