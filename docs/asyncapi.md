# AsyncAPI Specification

Select **AsyncAPI Specification** in Developer Hub. Supply API ID, description,
Owner, System, and one complete AsyncAPI YAML document in the textarea. The
submitted text is preserved as `specification.yaml`; inline Avro and JSON Schema
payloads, multiple channels/messages and internal references are supported.

The template publishes and registers a dedicated API repository and opens a System
pull request at `apis/<id>/values.yaml`. Merge that pull request to provision the
GitOps-managed pipeline. The initial hook runs it automatically; later main
commits and real release tags follow the existing API contract lifecycle.

The pipeline validates the document and native payloads, publishes the ASYNCAPI
contract plus independent AVRO/JSON artifacts to the System registry group, and
imports the complete document into Microcks. Generated payload files stay on the
PipelineRun workspace. See developer-charts `charts/api/openapi/ASYNCAPI.md` for
stable artifact identity, compatibility, and Apicurio Kafka client configuration.
The reusable verification contract is `test/fixtures/asyncapi/order-events.yaml`
in developer-charts. Its broker hostname is illustrative; scaffolding does not
provision a broker or producer/consumer applications.
