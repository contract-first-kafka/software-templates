# EventCatalog architecture correction — verification

Verified on 2026-10-22. This replaces the existing generator in place. It creates
native Domains and Systems, Services only for registered CF-IDP Components,
independent Events and topic Channels, native payload schemas and contract docs.
Producer/consumer relationships come exclusively from Component message selections.

## Source and release commits

- software-templates: `96fc7c2cc9e53a4caa17b8b238896c9ba80c627c` implements the correction;
  `2d5efa9e0e7f2e122368f1c8f970dbf83440c3a6` fixes chronological ordering of native
  versions; `ed22ac33b3e754599ffb42a3fb7a9f91718789e5` preserves exact channel
  relationships through native builds and runtime. Released as `v1.6.2`.
- developer-charts: `99c771d98115da78e5c38d982a9aaa6c7d2a687e` removes assumptions about
  generator-specific license files from the existing pipeline. Released as `v1.4.1`.
- demo-domain: `f9bb3660eddea02cbf2b7c4092849cb692284466` migrates the existing copied
  project; `be3b1f08742371f045cc5c07d9cd9acde12d6707` includes the ordering correction;
  `95a8c7094d739c6bd04f736bceb70414adeaebb4` preserves native channel relationships;
  `790c2c5faee9ce2ea5d8e9542a8270385f4304f7` selects the final immutable image below.
- platform-components: `528b64c5aed1624f5ac804bb1fa0bef0306aebd4` and
  `b1d5f8967811a7008763c39f91752a3ca1d4734b` select compatible releases;
  `25c05112b975cb55c68456171382adadf169091a` selects final templates `v1.6.2`.
  Separate operational commit `8f0aad2e3099db02be824c1c162dff2ccb548132` increases
  the saturated Argo controller memory limit (details below).

All changes were committed directly to existing default branches as `davgordo`
(`davgordo@redhat.com`). No forks, feature branches, PRs, alternate templates,
standalone packages, services, or new Domains/Systems/Components were created.
The Domain migration needed a user-approved temporary App-only exception to its
PR-required branch protection. The exception was removed after the migration and
image-intent commits; PR requirements and administrator enforcement were restored.

## Automated tests and real local builds

- software-templates: 79 tests in 16 suites; nine release tests; sibling compatibility
  and exact release-tag validation passed.
- developer-charts: 36 tests in nine suites and ten release tests passed.
- platform-components: 43 tests in six suites passed, including the controller configuration change.
- Actual EventCatalog core **5.4.1** server builds completed for the independent
  reference contract, mixed/pinned/selective fixture, and populated demo. Core was
  not upgraded. AsyncAPI parser 3.6.0, Avro parser 3.0.24 and SDK 2.31.2 were used.

The unchanged `developer-charts/test/fixtures/asyncapi/order-events.yaml` SHA-256 is
`032706b7ff91c175b0c51849f973bf329238306cd5490155b071ea884b2d39b7`.
The seven design standards were not edited. The Component form and every existing
scaffolder step are structurally identical to v1.5.0; only the Domain refresh
webhook step was added. Java runtime, generated event-contracts.json, Registry
publication and Microcks integration were not changed.

Local fixtures exercise all requested model transitions: no implementations,
publisher, consumer, mixed and selective roles, shared messages and topics,
multiple contracts, pinned versions, metadata changes, removal, contract schema
changes and unchanged-input fingerprinting. AsyncAPI 3.0/3.1, Avro, JSON Schema
and local schema references are covered. Application-only source edits retain the
same digest. Missing references/versions and malformed selections fail.

Native MCP was initialized and actual tools were called, rather than checking an
HTTP health response. Contract-only results are one Domain, one System, three
Events, three Channels and **zero Services**. The populated fixture returns five
real Services and six Event/Channel versions. Version-specific reverse lookups
place the pinned consumer only on the old revision. Native latest returns the
current publishers. Schema and custom-document retrieval succeeded. Browser checks
passed for all 20 fixture resource/document pages, including historical versions.
See [contract-only MCP](eventcatalog-architecture-evidence/contract-only-mcp.json),
[pinned/mixed MCP](eventcatalog-architecture-evidence/pinned-and-mixed-mcp.json), and
[local UI](eventcatalog-architecture-evidence/local-ui.json).

The real browser/MCP tests found two issues not visible in script-only tests:
custom documents require `docs/`-prefixed native IDs in core 5.4.1, and same-logical-
version source revisions must sort by commit time rather than arbitrary SHA text.
Both were corrected and re-tested. Deep live resource checks additionally exposed
core 5.4.1’s automatic legacy channel migration: it replaced explicit Component
channel bindings and deleted independent Event channels. The supported
`EVENTCATALOG_DISABLE_CHANNEL_MIGRATION=true` switch is now set for build/start
and the existing container runtime. The opt-in real-build regression
`node test/live/eventcatalog-architecture.mjs /path/to/eventcatalog` compares every
generated native resource before build, after build, and in the packaged runtime.

## Existing demo migration and live pipeline

The existing `demo` Domain has two activated Systems, three independent contracts,
and five real Components: `event-handler`, `event-publisher`, `order-intake`,
`order-rest`, and `ride-scheduler`. Its authored documentation was preserved; the
obsolete paragraph describing fictional contract Services was corrected.
All five Component repositories now have the existing Domain refresh push hook.

`eventcatalog-architecture-bindings` ran the existing production acquire-Lease,
clone, discover, generate/build, buildah/Quay, and release-Lease tasks on OpenShift.
The final build cloned commit `95a8c7094d739c6bd04f736bceb70414adeaebb4`.
Input digest:
`3eb2369551082296ba0e709222f97dd4dba1ee110f244c062e26bc3f5f4ef309`.
Published immutable image:
`registry-quay-quay.apps.cluster-ggvsm.dyn.redhatworkshops.io/openshift_demo-catalog/eventcatalog@sha256:8490b804f5268b8c6f414627c7821074266bd0529a91b4ad41c54a3f835cc86b`.

To obey the task's no-PR instruction, this disposable PipelineRun omitted only the
normal PR-producing intent task and final automatic refresh. The successful image
intent was committed directly, then reconciled through the existing Argo Domain
Application. The normal production Pipeline and its publication implementation
were preserved. This is a migration verification deviation, not a second golden
path or permanent pipeline.

Two overlapping refreshes against the preceding image used the unmodified production Pipeline. Run A
acquired the Lease and discovered `changed=false` with the same fingerprint; run B
reported `acquired=false`. Neither ran generation, image publication or intent
publication. Lease coalescing and unchanged-build skipping worked on the cluster.
The final `eventcatalog-architecture-final-unchanged` run then cloned
`790c2c5faee9ce2ea5d8e9542a8270385f4304f7`, returned the final fingerprint above
with `changed=false`, and skipped generation, image publication and intent
publication. All four executed tasks succeeded.

The final deployed image was checked through the public native MCP endpoint and
browser. All five Component send/receive channel bindings, all five independent
Event channel sets, exact source revisions, and all payload schemas match generated
source. All **21** resource and contract-document pages returned HTTP 200 with
expected content. Runtime reports core **5.4.1** and the channel-migration disable
setting. All **45** Argo Applications were Synced/Healthy. Developer Hub serves the
exact released `v1.6.2` Component template.

- [Live native MCP and exact relationships](eventcatalog-architecture-evidence/live-mcp.json)
- [Live browser pages](eventcatalog-architecture-evidence/live-ui.json)
- [Deployment, hooks and restored protection](eventcatalog-architecture-evidence/deployment.json)
- [Pipeline and task results](eventcatalog-architecture-evidence/cluster-pipeline.json)

## Scope and limitations

Model mutation scenarios used temporary local Git fixtures rather than modifying
existing tenant applications. No Kafka runtime exchange was repeated: runtime code
and selection behavior were unchanged and their existing regression suites passed.
Explicit contract versions must resolve to Git commits or release tags; missing or
mutable remote schema references fail rather than silently substituting latest.
Other previously scaffolded Domains need the documented in-place migration; a
new template release does not rewrite their copied project files automatically.

During deployment, the Argo controller became unready at approximately 2036 MiB
against its 2 GiB limit. A restart briefly restored readiness, but the same saturation returned as its
cache repopulated. A separate platform commit raises only its memory limit to
4 GiB, with CPU, storage and GitOps ownership unchanged. This operational fix is
separate from the EventCatalog model correction.

## Cleanup

All six task-created validation PipelineRuns and their owned PVCs were removed
after archiving results; see [cleanup inventory](eventcatalog-architecture-evidence/cleanup.json).
Temporary local servers and installed build fixtures were removed. The existing
`demo` Domain remains running with its corrected implementation. No tenant
application, shared service, repository, or contract was deleted.
The GitHub App bypass was removed and the original Domain hook state restored
in the same operation as each protected commit; final API checks confirmed both.
