import fs from 'node:fs';
const inputs = JSON.parse(fs.readFileSync(process.cwd() + '/.discovery.json'));
const overview = fs.readFileSync(process.cwd() + '/docs/index.mdx', 'utf8').replace(/^---[\s\S]*?---\s*/, '');
export default {
  title: inputs.domain.name,
  tagline: 'Domain architecture and authoritative API contracts',
  organizationName: inputs.organization,
  homepageLink: process.env.CATALOG_URL || inputs.resolved[0].url.replace(/\.git$/, ''),
  trailingSlash: 'always',
  output: 'server',
  mcp: {enabled: true},
  // No model provider is configured; avoid the unused chat widget and its SSR greeting mismatch.
  chat: {enabled: false},
  generators: inputs.services.length ? [[
    '@eventcatalog/generator-asyncapi', {
      parseChannels: true,
      parseSchemas: true,
      parseExamples: true,
      messages: {id: {prefixWithServiceId: true}},
      services: inputs.services,
      domain: {...inputs.domain, generateMarkdown: () => overview},
    }
  ]] : [],
};
