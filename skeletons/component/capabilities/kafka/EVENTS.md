# Kafka contract interfaces

`src/main/resources/event-contracts.json` declares the selected registry versions,
channel/message keys and Component roles. It is used directly by `EventContracts`
and `EventRoutes`. It does not infer application roles from contract operations.

Quarkus Camel Java DSL supports REST and Kafka together in one application. Other
profiles remain OpenAPI-only. This initial Kafka capability supports JVM builds,
AsyncAPI 3.0/3.1, concrete Kafka topics, inline Avro/JSON payload schemas with internal
references, and CloudEvents 1.0 binary headers. Native builds are not supported.

Set `KAFKA_BOOTSTRAP_SERVERS` through System environment `runtime.env` referencing
the Kafka Resource's `<resource>-<environment>-connection` ConfigMap. Registry URL
comes from the platform target and can be overridden with `APICURIO_REGISTRY_URL`.
The initial Kafka Resource provides a namespace-local plaintext listener.

At startup the application reads the selected contract from Apicurio. `latest`
floats on restart; release versions and Git SHAs remain pinned. It resolves each
schema using the Specification pipeline's payload-reference identity and matches
its exact published content, including when publication deduplicated an unchanged
schema under an earlier Git version. Missing contracts/schemas fail startup. It
never registers schemas. Registry reads use the platform's anonymous read access;
authenticated registries require additional client configuration.

Quarkus BOM-managed Apicurio 3.x serializers perform native Avro and validated JSON serialization.
Schema ID location follows the message Kafka binding; the standard global-ID
header or payload framing is used. Consumers only accept the selected schema
versions. Multiple messages on one topic are dispatched by that ID. A consumer
selecting one message does not claim to consume the others.

Publisher entry points are `direct:events.<alias>.<channel>.<message>`. Without a
REST operation mapping the scaffold exposes `POST /events/<alias>.<channel>.<message>`
with a JSON body. With `restOperation`, the provided OpenAPI operation forwards its
body to that publisher. The developer must choose a compatible request schema;
no business field mapping is invented. Kafka acknowledgement precedes the response.

CloudEvents `ce_type` and `ce_source` derive from the contract example; `ce_id` is
fresh for each publication. Producers do not reuse example IDs. Consumers validate
those headers and log `EVENT_HANDLED` after deserialization. Replace the generated
handler with business logic. Invalid/unselected records log `EVENT_REJECTED` and
are skipped so a poison record cannot block the partition. This deliberately
simple policy provides no dead-letter storage or exactly-once business processing.
No payload data is logged. Configure a suitable error policy before production.

`./mvnw test` checks application startup with external event connections disabled.
Integration verification must additionally exercise a real Kafka broker and registry;
a successful build alone does not establish wire interoperability.
