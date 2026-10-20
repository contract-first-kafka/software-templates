package ${{ values.java_package }};

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.apache.avro.Schema;
import org.apache.avro.generic.GenericDatumReader;
import org.apache.avro.io.DecoderFactory;
import org.apache.kafka.common.header.Headers;
import org.apache.kafka.common.header.internals.RecordHeaders;
import org.apache.kafka.common.serialization.Serializer;
import org.apache.kafka.common.serialization.Deserializer;
import io.apicurio.registry.serde.avro.AvroKafkaSerializer;
import io.apicurio.registry.serde.avro.AvroKafkaDeserializer;
import io.apicurio.registry.serde.jsonschema.JsonSchemaKafkaSerializer;
import io.apicurio.registry.serde.jsonschema.JsonSchemaKafkaDeserializer;
import com.fasterxml.jackson.databind.JsonNode;

/** The standard Apicurio SerDes own schema resolution and Kafka wire encoding. */
public final class EventCodec implements AutoCloseable {
    final EventContracts.Selection selected;
    final Serializer<Object> serializer;
    final Deserializer<Object> deserializer;
    final Schema avroSchema;

    public EventCodec(EventContracts.Selection selected, String registry) {
        this.selected = selected;
        Map<String,Object> config = new HashMap<>();
        config.put("apicurio.registry.url", registry);
        config.put("apicurio.registry.artifact.group-id", selected.group());
        config.put("apicurio.registry.artifact.artifact-id", selected.artifact());
        config.put("apicurio.registry.artifact.version", selected.version());
        config.put("apicurio.registry.auto-register", false);
        config.put("apicurio.registry.headers.enabled", selected.headers());
        config.put("apicurio.registry.use-id", "globalId");
        config.put("apicurio.registry.serde.validation-enabled", true);
        config.put("apicurio.registry.serde.send-type-ref", false);
        config.put("apicurio.registry.serde.read-type-ref", false);
        config.put("apicurio.registry.deserializer.value.return-class", JsonNode.class.getName());
        serializer = selected.avro() ? new AvroKafkaSerializer<>() : new JsonSchemaKafkaSerializer<>();
        deserializer = selected.avro() ? new AvroKafkaDeserializer<>() : new JsonSchemaKafkaDeserializer<>();
        serializer.configure(config, false);
        deserializer.configure(config, false);
        avroSchema = selected.avro() ? new Schema.Parser().parse(selected.schema().toString()) : null;
    }

    public RecordHeaders headers() {
        RecordHeaders headers = new RecordHeaders();
        if (selected.exampleHeaders().has("ce_specversion")) {
            add(headers, "ce_specversion", "1.0");
            add(headers, "ce_id", UUID.randomUUID().toString());
            add(headers, "ce_source", selected.exampleHeaders().path("ce_source").asText());
            add(headers, "ce_type", selected.exampleHeaders().path("ce_type").asText());
        }
        add(headers, "content-type", selected.message().path("contentType").asText(selected.avro() ? "application/avro" : "application/json"));
        return headers;
    }
    static void add(Headers headers, String key, String value) { headers.add(key, value.getBytes(StandardCharsets.UTF_8)); }
    static String header(Headers headers, String key) {
        var h = headers.lastHeader(key);
        return h == null ? "" : new String(h.value(), StandardCharsets.UTF_8);
    }
    public byte[] encode(String json, Headers headers) throws Exception {
        Object value = selected.avro()
                ? new GenericDatumReader<>(avroSchema).read(null, DecoderFactory.get().jsonDecoder(avroSchema, json))
                : EventContracts.JSON.readTree(json);
        return serializer.serialize(selected.topic(), headers, value);
    }
    public boolean matches(Headers headers, byte[] bytes) {
        long id;
        if (selected.headers()) {
            var header = headers.lastHeader("apicurio.value.globalId");
            if (header == null || header.value().length != 8) return false;
            id = ByteBuffer.wrap(header.value()).getLong();
        } else {
            if (bytes == null || bytes.length < 9 || bytes[0] != 0) return false;
            id = ByteBuffer.wrap(bytes, 1, 8).getLong();
        }
        return id == selected.globalId();
    }
    public Object decode(Headers headers, byte[] bytes) {
        if (!matches(headers, bytes)) throw new IllegalArgumentException("Record schema is outside the selected contract version");
        if (selected.exampleHeaders().has("ce_specversion")) {
            if (!header(headers, "ce_specversion").equals("1.0") || header(headers, "ce_id").isBlank()
                    || !header(headers, "ce_source").equals(selected.exampleHeaders().path("ce_source").asText())
                    || !header(headers, "ce_type").equals(selected.exampleHeaders().path("ce_type").asText()))
                throw new IllegalArgumentException("Invalid CloudEvents binary headers");
        }
        return deserializer.deserialize(selected.topic(), headers, bytes);
    }
    public void close() { serializer.close(); deserializer.close(); }
}
