import fs from 'node:fs';
import path from 'node:path';

// Allowlist runtime inputs: never package Git checkouts, credentials or build caches.
const destination = '.runtime';
fs.rmSync(destination, {recursive: true, force: true});
fs.mkdirSync(destination);
for (const name of ['dist', 'package.json', 'package-lock.json', 'eventcatalog.config.js',
  '.discovery.json', 'docs', 'domains', 'services', 'events', 'commands', 'queries', 'channels']) {
  if (fs.existsSync(name)) fs.cpSync(name, path.join(destination, name), {recursive: true});
}
for (const required of ['dist/server/entry.mjs', '.discovery.json', 'docs/index.mdx']) {
  if (!fs.existsSync(path.join(destination, required))) throw new Error(`Missing runtime input: ${required}`);
}
// The read-only fields index is generated at build time, not a runtime database service.
const index = '.astro/eventcatalog/.eventcatalog/fields.db';
if (fs.existsSync(index)) {
  fs.mkdirSync(path.dirname(path.join(destination, index)), {recursive: true});
  fs.copyFileSync(index, path.join(destination, index));
}
const licenses = path.join(destination, 'dist/client/LICENSES');
fs.mkdirSync(licenses, {recursive: true});
for (const [source, target] of [
  ['@eventcatalog/core/LICENSE', 'EventCatalog.txt'],
  ['@eventcatalog/core/NOTICE', 'EventCatalog-NOTICE.txt'],
  ['@eventcatalog/generator-asyncapi/LICENSE', 'AsyncAPI-generator.txt'],
]) fs.copyFileSync(path.join('node_modules', source), path.join(licenses, target));
