# Domain EventCatalog

Run `npm ci`, `npm run discover`, `npm run generate`, and `npm run build` from this
folder. Discovery follows Domain System activation files and System API values,
fetching their specified Git revisions. `.discovery.json` records resolved SHAs.
No contract inventory or generated schemas are maintained here.

Maintain architectural context in `docs/`. Native AsyncAPI generation writes only
ignored build resources and preserves authored documentation. Empty Domains still
serve their authored documentation.

EventCatalog 5.4.1 uses BSL 1.1; the official AsyncAPI generator 7.1.0 is MIT.
This reference architecture uses synthetic, non-production data. Enterprise
production use may require a commercial license. Package license notices are
preserved by npm; see `LICENSES/` in the published application.

Native generator 7.1.0 represents contracts as Services beneath a Domain and does
not create native System resources. Contract Service names and summaries retain
the source System and owner; Git remains the authority for System membership.
These Services do not imply deployed Components. Native sends/receives describe
the contract operations, not verified implementation relationships.

## Native server and MCP

The build uses `output: 'server'` and `mcp: {enabled: true}` with core 5.4.1.
`npm run build` also creates an allowlisted `.runtime/` container context. Buildah
installs only production dependencies from the lockfile; the generator and direct
YAML discovery dependency are build-only. The pinned Node.js 24 UBI image runs
`eventcatalog start` as a non-root user on `0.0.0.0:8080`; OpenShift can assign its
own UID. No Git checkout, credential, `.env`, or npm cache is copied into runtime.
Core's published package includes its own transitive tooling; it remains intact
because the supported CLI and server import its bundled runtime dependencies.

The generated `dist/`, resource directories, authored docs, `.discovery.json`, and
build-time fields index travel with the image. The config reads `.discovery.json`
and `docs/index.mdx` at startup, so both must be retained. Discovery and generation
never run in the serving container. The generator's contract Services do not imply
deployed Components, and it does not synthesize native System resources.

Connect a Streamable HTTP MCP client to `https://<catalog-route>/docs/mcp`.
Use the exact path without a trailing slash. The endpoint performs standard MCP
`initialize`, `notifications/initialized`, `tools/list`, and `tools/call`
interactions. A browser GET is health metadata, not a protocol verification.
The server is stateless; its optional SSE GET channel returns 405 by design.

Useful native tools include `getResources`, `getResource`,
`getSchemaForResource`, `getMessagesProducedOrConsumedByResource`,
`getProducersOfMessage`, `getConsumersOfMessage`, `showResource`, and the custom
documentation tools. Use `getResources` to discover IDs before querying them.
`resources/list` also exposes `eventcatalog://` collection resources.
An MCP client configuration can use:

```json
{"mcpServers":{"eventcatalog":{"type":"http","url":"https://<catalog-route>/docs/mcp"}}}
```

Core 5.4.1's native service-schema tool treats `/generated/...` asset URLs as
filesystem paths. The image provides `/generated` as a read-only symlink to
`dist/client/generated`; without this, `getSchemaForResource` fails for AsyncAPI
specifications even when message schemas work. This is a packaging compatibility
workaround, not a custom server or contract parser.

MCP is unauthenticated for this public synthetic demonstration. It exposes the
same generated contracts, schemas, ownership, and documentation in machine-readable
form. Studio and the unconfigured AI chat widget are disabled; no custom write tools are added.
The chat widget in core 5.4.1 otherwise renders a timezone-dependent greeting that
causes an SSR hydration warning for clients in a different timezone. Before production,
review data classification, EventCatalog's native MCP authentication, authorization,
network access, rate limits, and the core BSL license/commercial-use terms. Preserve
`/LICENSES/EventCatalog.txt`, `/LICENSES/EventCatalog-NOTICE.txt`, and
`/LICENSES/AsyncAPI-generator.txt`. MCP is not a separate publishing destination.

The pipeline still uses input fingerprints, unchanged-build skipping, a Kubernetes
Lease, Quay image digests, image-intent PRs, and the existing Domain Argo Application.
