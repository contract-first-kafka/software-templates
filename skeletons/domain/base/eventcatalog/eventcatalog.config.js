import fs from 'node:fs';
const inputs = JSON.parse(fs.readFileSync(process.cwd() + '/.discovery.json'));
export default {
  title: inputs.domain.metadata.title || inputs.domain.metadata.name,
  tagline: 'Domain architecture and authoritative API contracts',
  organizationName: inputs.organization,
  homepageLink: process.env.CATALOG_URL || inputs.resolved[0].url.replace(/\.git$/, ''),
  trailingSlash: 'always',
  output: 'server',
  mcp: {enabled: true},
  chat: {enabled: false},
};
