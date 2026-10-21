# Kafka Component selection

Use the Quarkus Camel Java DSL/JVM implementation profile and select a Kafka Resource
in the Component's System. For each Kafka event contract, choose the existing catalog
AsyncAPI entity, a contract version (default `latest`), and **Publish** or **Consume**.
The selected role applies to every channel/message pair in that contract. Roles describe
this Component; AsyncAPI operation actions do not determine them.

Use **Advanced configuration** to select individual channel/message keys, assign different
roles, or map a published message to a provided REST operation. Advanced selections replace
the all-messages selection. Turning Advanced off restores the simple role even if the form
retains hidden field data. Existing explicit `messages` inputs without the new `advanced`
flag remain compatible.

The resolver runs after retrieving and parsing the chosen Registry version and before the
existing selection validator. It preserves channel-local message keys, including reused
message definitions and channels sharing a topic. Both modes generate the same `event_apis`
and `event-contracts.json` for equivalent selections. The Kafka Resource connection model,
Java runtime, schema resolution, supported AsyncAPI 3.0/3.1 versions, and implementation
profile restrictions are unchanged.

Prefer a pinned contract version for reproducible releases. Selecting every message does
not provision Kafka topics; provision the topics through the environment's existing process.

See [live verification](kafka-component-selection-verification.md) for the disposable
end-to-end environment, evidence, limitations, and cleanup instructions.
