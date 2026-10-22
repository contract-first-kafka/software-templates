import fs from 'node:fs';
import path from 'node:path';

// Allowlist runtime inputs: never package Git checkouts, credentials or build caches.
const destination = '.runtime';
fs.rmSync(destination, {recursive: true, force: true});
fs.mkdirSync(destination);
for (const name of ['dist', 'package.json', 'package-lock.json', 'eventcatalog.config.js',
  '.discovery.json', 'docs', 'domains', 'services', 'events', 'commands', 'queries', 'channels', 'systems', 'teams']) {
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
  ['@asyncapi/avro-schema-parser/LICENSE', 'Avro-schema-parser.txt'],
  ['@eventcatalog/sdk/LICENSE', 'EventCatalog-SDK.txt'],
]) fs.copyFileSync(path.join('node_modules', source), path.join(licenses, target));

// The parser npm tarball omits its license file; retain its published license attribution.
fs.writeFileSync(path.join(licenses, 'AsyncAPI-parser.txt'), '@asyncapi/parser 3.6.0 — Apache-2.0\nhttps://github.com/asyncapi/parser-js/tree/v3.6.0\n');
