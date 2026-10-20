# ${{ values.resourceName }}

Red Hat Streams for Apache Kafka Resource for `${{ values.systemName }}`.

Desired state belongs to the [System repository](${{ values.systemRepoWebUrl }})
under `resources/kafka/${{ values.resourceName }}`. Each activated environment owns
its Kafka cluster; this repository contains catalog metadata and documentation.

See [operations](docs/index.md) for connection and storage conventions.
