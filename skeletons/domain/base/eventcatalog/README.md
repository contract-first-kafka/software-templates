# Domain EventCatalog

Run `npm ci`, `npm run discover`, `npm run generate`, and `npm run build` here.
The project pins EventCatalog core 5.4.1, AsyncAPI parser 3.6.0, Avro schema parser
3.0.24 and EventCatalog SDK 2.31.2. Generation is a build step in this existing
Domain project, with no independent package, service or deployment.

## Authoritative inputs and native resources

Discovery follows the Domain's build-environment activations, System
`apis/*/values.yaml` and `components/*/values.yaml` registrations. Git remains
authoritative. An API supplies its catalog entity and original specification;
a Component supplies its catalog entity and `src/main/resources/event-contracts.json`.
A Component without Kafka selections is still a real Service.

The generated Domain links native Systems, and Systems link real Component
Services. Independent contracts produce Events, Kafka Channels, attached payload
schemas, examples, header documentation and contract documentation, even with no
Components. A contract never creates a Service. Channel/message declarations are
complete regardless of root operation actions. Component message roles alone
produce Service `sends`/`receives`, with exact channel-specific `to`/`from` pointers.
Shared message references yield one Event; multiple channel keys with the same
Kafka topic share one Channel within their contract. Independent contracts retain
separate identities, even if topic addresses happen to match.

Contracts are discoverable from the System page, Events, and native custom docs
under `docs/generated-contracts/`. Each documentation page links the exact Git
source and an unchanged downloadable AsyncAPI document. Avro schemas retain their
native format. JSON Schema references are bundled into local `$defs`, including
recursive payload references. CloudEvents headers and message examples remain
available on Event pages. The seven design standards and reference contract are
unchanged.

## Versions and validation

`latest` selects the API's registered Git revision. An explicit Component contract
version must resolve as a Git commit or published tag in that API repository;
missing versions fail rather than falling back to latest or querying mutable
Registry content. Release tags should match the version used by the existing
publication pipeline. Source SHA, selected Registry version, logical `info.version`
and catalog API identity are retained separately. Native Event and Channel
versions include the logical version and exact source SHA (`1.0.0-git.<commit-time>.<sha>`), so
native version ordering follows Git commit time rather than arbitrary SHA text, and
two publications with the same logical version cannot silently overwrite one
another. Pinned and current revisions can coexist. Domain, System and Service
versions are `1.0.0` architectural identities; their metadata records source SHAs.

Missing registrations, wrong System membership, missing message keys, invalid
roles, inconsistent catalog API relationships and unsupported contracts fail the
build with context. Remote schema references must be vendored in the API Git
repository so the input fingerprint covers their content.

## Regeneration and authored documentation

Edit business context in `docs/index.mdx` and other authored native MD/MDX pages.
Use `title` and `summary` frontmatter. Generated resource directories and
`docs/generated-contracts/` are reserved build outputs and must not hold authored
content. Generation validates the complete model before replacing generated
resources, removes stale Services and relationships, and preserves authored docs.

The input digest includes activated registrations, API metadata and source
specifications (including local references and pinned revisions), Component
catalog metadata and event selections, and tracked project sources. Application
source-only edits do not rebuild the catalog. Component source SHAs in the image
record the discovery that produced that image; they are not deployment versions.
Image-intent changes are excluded to avoid refresh loops. The existing Kubernetes
Lease, unchanged-build skipping, Tekton pipeline, immutable Quay image and GitOps
image-intent flow remain in place. Domain, System and Component push hooks and
successful AsyncAPI publication request refreshes.

## Native UI, runtime and MCP

The existing server build uses core 5.4.1, `output: 'server'`, and native MCP.
Connect a Streamable HTTP client to `https://<catalog-route>/docs/mcp` (no trailing
slash). Exercise actual `tools/call` requests; an HTTP health response is not an
MCP verification. Native `getResources`, `getResource`,
`getMessagesProducedOrConsumedByResource`, `getProducersOfMessage`,
`getConsumersOfMessage`, `getSchemaForResource` and custom-document tools read the
same architecture as the UI. Discover IDs with `getResources`; independent
contracts are documents, not Services with specification attachments.

`package-runtime.mjs` retains only serving assets, generated native resources,
authored/generated docs, discovery provenance and the build-time fields index.
Git checkouts, credentials and build caches are excluded. The existing `/generated`
asset symlink and non-root Node.js container remain. No new runtime database or
controller is introduced. License notices are retained under `/LICENSES/`.
The public demonstration uses native unauthenticated MCP; production deployment
must select the appropriate native access controls and EventCatalog licensing.

## Existing Domains

These scripts are copied at scaffolding time. Updating the template release alone
does not migrate existing Domains. Update the current Domain's `eventcatalog/`
package files, config, scripts and ignore rules in place, preserving its authored
docs. Add the existing Domain refresh URL as a push webhook to registered Component
repositories. Rebuild through its existing pipeline, commit the immutable image
intent, and verify native UI and MCP results before declaring migration complete.
