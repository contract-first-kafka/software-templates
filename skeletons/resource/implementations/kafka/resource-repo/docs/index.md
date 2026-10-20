# Kafka operations

The System Resource ApplicationSet deploys a Kafka cluster and KRaft node pool in
each activated System environment. Requires the platform Streams 3.2 operator.
Kafka version: `${{ values.kafkaVersion }}`; replicas: `${{ values.replicaCount }}`.

One replica is for development only. Three replicas provide a quorum and replicated
internal topics. Persistent volumes are retained when resources are deleted.
Storage size and class are selected in System GitOps configuration.

The internal plaintext listener accepts pods in the same namespace through the
operator-managed NetworkPolicy. No external listener or authentication is provided
by this initial trusted-System profile. It is not a production security profile.

For environment `dev`, use this Component environment configuration:

```yaml
runtime:
  env:
    - name: KAFKA_BOOTSTRAP_SERVERS
      valueFrom:
        configMapKeyRef:
          name: ${{ values.resourceName }}-dev-connection
          key: KAFKA_BOOTSTRAP_SERVERS
```

Verify `Kafka.status.conditions` contains `Ready=True`, all node pool pods are
ready, and produce/consume a record before declaring the Resource operational.
Topic specifications can be managed as KafkaTopic resources referencing this
cluster's `strimzi.io/cluster` label; auto-creation is available for development.
