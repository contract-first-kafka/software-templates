# Kafka Component selection — live verification

Feature PR: [software-templates #5](https://github.com/contract-first-kafka/software-templates/pull/5).
The feature remains **unmerged**, pending approval. Validation date: 2026-10-21.

## Scope and candidate provenance

Implementation changes are confined to `templates/component/template.yaml` and
`test/contracts/component-events.test.js`; accompanying documentation and evidence describe
usage and live verification. No Java, generated JSON format, dependency, broker-discovery,
chart, or shared platform-runtime changes are included.

The final code candidate is `c77a47d8401ba437e1a389a7f311385e57461582`. A validation-only
child commit, `d0e29019b1221f9287845c35b447613df684958a`, changes only the template name/title
to `component-kafka-ux-final`. Its immutable URL was registered alongside the default template;
the default catalog entry and release pins were not changed. The catalog spec exactly matches
the feature spec: [provenance](kafka-component-selection-evidence/candidate-provenance.json).

Both final Components were submitted through the **real browser form** using catalog pickers,
`latest`, and Publish/Consume. Neither request supplied message/channel keys:
[publisher input](kafka-component-selection-evidence/publisher-submission.json),
[consumer input](kafka-component-selection-evidence/consumer-submission.json).

## Disposable environment

All repositories below belong to `contract-first-kafka` and were created by deployed golden paths.

| Kind | Name | Repository / environment |
|---|---|---|
| Domain | `kafka-ux-check` | `kafka-ux-check-domain`; catalog namespace `kafka-ux-check-catalog` |
| System | `parcel-dispatch` | `parcel-dispatch-system`; development namespace `parcel-dispatch-dev` |
| AsyncAPI | `parcel-lifecycle` | `parcel-dispatch-parcel-lifecycle-api` |
| Kafka Resource | `parcel-broker` | `parcel-dispatch-parcel-broker-resource`; Kafka `parcel-broker-dev` |
| Publisher | `parcel-sender` | `parcel-dispatch-parcel-sender-service` |
| Consumer | `parcel-handler` | `parcel-dispatch-parcel-handler-service` |
| Advanced scaffold | `parcel-mixed-final` | `parcel-dispatch-parcel-mixed-final-service`; wiring PR #9 intentionally unmerged |

[Scaffolder tasks and output links](kafka-component-selection-evidence/scaffolder-tasks.json)
record each actual task and template revision. Platform admission PR #17 and Domain System
activation PR #1 were merged only to provision this test environment. System wiring PRs #2,
#3, #7, and #8 activate the broker, API pipeline, sender, and handler respectively.

The AsyncAPI 3.1 contract has `orders/accepted`, `orders/cancelled`, `audit/accepted`, and
`shipments/dispatched`: two Avro schemas and one JSON Schema, with examples and CloudEvents
headers. `orders` and `audit` intentionally share `ux.parcels` and reuse the accepted-message
schema; shipments use `ux.shipments`. Operation actions are all `receive`, while the sender's
Component role is `publish`, exercising independence from operation direction.

The specification pipeline validated, published the contract and three deduplicated payload
artifacts, imported four Microcks operations, and passed its Microcks completeness gate.
[Registry/Microcks evidence](kafka-component-selection-evidence/registry-microcks.json).
The broker's connection ConfigMap is `parcel-broker-dev-connection`, containing
`KAFKA_BOOTSTRAP_SERVERS=parcel-broker-dev-kafka-bootstrap:9092`.
The two topics were explicitly provisioned only in this namespace using
[KafkaTopic manifests](kafka-component-selection-evidence/topics.yaml); no shared provisioning
behavior was changed.

Generated configuration contains all four selections for both simple-mode Components, and
only the two requested mixed-role selections for Advanced:
[sender](kafka-component-selection-evidence/parcel-sender-event-contracts.json),
[handler](kafka-component-selection-evidence/parcel-handler-event-contracts.json),
[mixed](kafka-component-selection-evidence/parcel-mixed-final-event-contracts.json).

## Live result

**Passed:** the specification and final Component pipelines completed, both final deployments
are Ready, and all **41** Argo Applications are Synced/Healthy.
[Workloads](kafka-component-selection-evidence/workloads.json),
[GitOps](kafka-component-selection-evidence/gitops.json), and
[broker connection](kafka-component-selection-evidence/broker-connection.json).

| Pipeline | Result |
|---|---|
| `parcel-lifecycle-api-initial-ssztm` | Completed; publication and Microcks verification passed |
| `parcel-sender-run-wh65k` | Completed; Maven package, image push, latest publication, runtime restart |
| `parcel-handler-run-gqc8d` | Completed; Maven package, image push, latest publication, runtime restart |

The real publisher is [parcel-sender](https://parcel-sender-parcel-dispatch-dev.apps.cluster-ggvsm.dyn.redhatworkshops.io).
Four HTTPS POSTs to its generated `/events/default-parcel-lifecycle.<channel>.<message>`
routes returned HTTP 200 and broker partition/offset acknowledgments. Before traffic, an
independent reader confirmed both topics were empty. It then used standard Apicurio 3.2.5
Avro/JSON Schema deserializers (not the generated codec) to read and validate all four records.

| Selected combination | Topic / partition / offset | Payload format | Apicurio global ID |
|---|---|---|---|
| `orders/accepted` | `ux.parcels / 0 / 0` | Avro | 15 |
| `orders/cancelled` | `ux.parcels / 0 / 1` | Avro | 16 |
| `audit/accepted` | `ux.parcels / 0 / 2` | Avro, reused schema | 15 |
| `shipments/dispatched` | `ux.shipments / 0 / 0` | JSON Schema | 17 |

Decoded payloads exactly match the submitted payloads. Every record has `ce_specversion=1.0`,
a unique `ce_id`, the expected contract-derived `ce_type` and `ce_source`, content type,
and the existing `apicurio.value.globalId` identity header. All four corresponding event IDs
appear in the **final** handler's `EVENT_HANDLED` logs. No `EVENT_REJECTED` or ERROR entries
were observed in either final application's captured log. The handler started after publication
and consumed the records through its existing earliest-offset behavior.

[HTTP acknowledgments](kafka-component-selection-evidence/published-messages.json),
[independent wire records](kafka-component-selection-evidence/kafka-wire-records.json),
[handler log](kafka-component-selection-evidence/handler.txt),
[sender log](kafka-component-selection-evidence/sender.txt), and
[Microcks completeness gate](kafka-component-selection-evidence/microcks-verification.txt).
Run `python docs/kafka-component-selection-evidence/verify-evidence.py` to check the saved
acknowledgment → wire payload/schema → handler event-ID chain.

The consumer retains four selections but creates two topic routes, as the existing runtime
groups bindings by Kafka topic. The accepted/audit aliases share both topic and schema identity;
the existing runtime selects its first matching codec and logs `orders.accepted` for either.
Both records were successfully decoded/handled; no new routing semantics were introduced.

No new Registry versions were created by runtime traffic. All 10 pre-existing published
contract versions retained their content and state. The temporary inspector pod was removed;
the Domain, broker, topics, generated Components, and records remain available for inspection.

### Remaining regression risk

Live coverage is the existing Java DSL/JVM Kafka profile with AsyncAPI 3.1, a one-node development
broker, Avro and JSON Schema payloads, and internal references. AsyncAPI 3.0 and other profiles
are covered by repository regression tests; they were not separately redeployed. Advanced
mixed roles were exercised through an actual scaffold and generated-output comparison, not a
mixed-role runtime deployment. This is not a load, broker-failover, or production-security test.
`latest` retains its existing floating-version risk. The YAML-description and global catalog-name
limitations above remain separate issues, outside this feature PR.

## Regression results and operational deviations

All **68 tests across 15 suites** passed with `npm test --prefix test` from the repository.
Coverage includes publish/consume expansion, multiple channels/messages, reused references,
shared topics, AsyncAPI 3.0/3.1, equivalent downstream metadata and rendered JSON, mixed-role
Advanced overrides, invalid/unsupported inputs, OpenAPI-only empty event selections, and
existing implementation profiles. `git diff --check` passed.

Live native-form testing exposed retained hidden messages after Advanced was turned off.
The resolver now treats `advanced: false` as simple mode, while legacy explicit input with
no `advanced` flag remains compatible. The final sender and handler were scaffolded again
from the corrected immutable candidate, rather than relying on earlier outputs.

Two existing provisioning limitations were worked around only in the disposable environment:

- An API description containing a colon produced invalid unquoted catalog YAML. The first
  API task published `parcel-dispatch-parcel-events-api` but failed registration. A description-only
  fix was committed there; task retry reran publication and failed non-fast-forward. A fresh,
  complete golden-path task created `parcel-lifecycle` with a YAML-safe description. The abandoned
  repository is retained for inspection and is not wired into the System.
- The initial Resource name `events` conflicted with the existing global catalog entity. Its
  duplicate catalog location was removed, its catalog file archived to prevent rediscovery,
  and unmerged System PR #1 closed. The original
  `order-fulfillment` Resource remained unchanged. A fresh golden-path task created `parcel-broker`.

Earlier candidate Components `parcel-publisher` and `parcel-consumer` also exist in the disposable
System (wiring PRs #4/#5). They are not the final-candidate runtime proof. `parcel-mixed` is an
earlier Advanced scaffold with unmerged wiring PR #6. No existing tenant Domain or System was
used or modified.

## Cleanup after inspection

Do not run cleanup until the demonstration/inspection is finished. Export any wanted records
and contract sources first; deleting namespaces can delete their PVC-backed data.

1. Remove the two validation catalog locations (candidate URLs above; earlier candidate SHA
   `4b6824ec1103fb21969e35d370c11a5ef88a5444`) and their unique template entities. Keep the default
   Component template. Close unneeded disposable System PRs #6 and #9.
2. Remove only `tenants/kafka-ux-check/` through a platform admission-removal PR and let GitOps
   reconcile. Because ApplicationSet deletion is preservation-oriented, explicitly remove the
   retired `kafka-ux-check-domain` Application and its owned ApplicationSets/child Applications;
   inspect ownership before cascading. Do not change the global deletion policy.
3. Remove only `parcel-dispatch-dev` and `kafka-ux-check-catalog` after their Applications can no
   longer recreate them. This includes their test topics, Kafka data and build PVCs (the temporary inspector was already removed).
   Verify cleanup of Domain-owned publisher clients/secrets in shared namespaces by ownership;
   never delete shared Keycloak, Registry, Microcks, Quay, GitOps, or operators.
4. Unregister only this Domain's API, Resource, System, and Component catalog locations. Archive
   or delete the seven repositories in the table plus abandoned `parcel-dispatch-parcel-events-api`,
   `parcel-dispatch-events-resource`, and earlier `parcel-dispatch-parcel-{publisher,consumer,mixed}-service`
   repositories. Remove their webhooks and unused test branches. Preserve existing tenant repositories.

The environment is intentionally left available. The feature PR is not part of cleanup and must
not be merged without approval.
