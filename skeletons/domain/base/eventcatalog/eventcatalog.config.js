import fs from 'node:fs';
const inputs = JSON.parse(fs.readFileSync(new URL('./.discovery.json', import.meta.url)));
const overview = fs.readFileSync(new URL('./docs/index.mdx', import.meta.url), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
export default {
  title: inputs.domain.name,
  tagline: 'Domain architecture and authoritative API contracts',
  organizationName: inputs.organization,
  homepageLink: process.env.CATALOG_URL || inputs.resolved[0].url.replace(/\.git$/, ''),
  trailingSlash: 'always',
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
