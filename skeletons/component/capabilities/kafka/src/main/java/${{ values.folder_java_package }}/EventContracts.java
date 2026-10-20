package ${{ values.java_package }};

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;

/** Read-only contract discovery. Artifact identity matches the Specification pipeline. */
public final class EventContracts {
    static final ObjectMapper JSON = new ObjectMapper();
    static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());
    private final String registry;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

    public EventContracts(String registry) { this.registry = registry.replaceAll("/$", ""); }

    JsonNode get(String path, boolean yaml) throws Exception {
        var response = http.send(HttpRequest.newBuilder(URI.create(registry + path))
                .timeout(Duration.ofSeconds(30)).GET().build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IllegalStateException("Registry read " + path + ": HTTP " + response.statusCode());
        return (yaml ? YAML : JSON).readTree(response.body());
    }

    static String enc(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20"); }
    static String hash(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(JSON.writeValueAsBytes(value)));
    }
    static JsonNode resolve(JsonNode doc, JsonNode value) {
        Set<String> seen = new HashSet<>();
        while (value.has("$ref")) {
            String ref = value.path("$ref").asText();
            if (!ref.startsWith("#/") || !seen.add(ref)) throw new IllegalArgumentException("Unsupported reference " + ref);
            value = doc.at(ref.substring(1));
            if (value.isMissingNode()) throw new IllegalArgumentException("Unresolved reference " + ref);
        }
        return value;
    }
    // Resolve internal JSON references into the same local $defs used by the publisher.
    static JsonNode bundle(JsonNode doc, JsonNode value, boolean avro, ObjectNode defs, Map<String,String> refs) throws Exception {
        if (value.isArray()) {
            var out = JSON.createArrayNode();
            for (var child : value) out.add(bundle(doc, child, avro, defs, refs));
            return out;
        }
        if (!value.isObject()) return value;
        if (avro && value.has("$ref")) return bundle(doc, resolve(doc, value), true, defs, refs);
        ObjectNode out = JSON.createObjectNode();
        var fields = value.fields();
        while (fields.hasNext()) {
            var field = fields.next();
            if (field.getKey().equals("$ref")) {
                String ref = field.getValue().asText();
                if (!ref.startsWith("#/")) throw new IllegalArgumentException("External schemas are unsupported");
                if (!refs.containsKey(ref)) {
                    String name = "ref_" + hash(ref).substring(0,16);
                    refs.put(ref, name);
                    defs.set(name, bundle(doc, doc.at(ref.substring(1)), false, defs, refs));
                }
                out.put("$ref", "#/$defs/" + refs.get(ref));
            } else out.set(field.getKey(), bundle(doc, field.getValue(), avro, defs, refs));
        }
        return out;
    }

    public record Selection(String id, String role, String restOperation, String topic, String group,
            String artifact, String version, long globalId, boolean avro, boolean headers,
            JsonNode schema, JsonNode message, JsonNode exampleHeaders) {}

    public List<Selection> load(JsonNode selections) throws Exception {
        List<Selection> result = new ArrayList<>();
        Set<String> ids = new HashSet<>(), operations = new HashSet<>();
        for (JsonNode api : selections) {
            String group = api.path("registry_group_id").asText(), artifact = api.path("registry_artifact_id").asText();
            String base = "/groups/" + enc(group) + "/artifacts/";
            String version = api.path("version").asText();
            String selector = version.equals("latest") ? "branch=latest" : version;
            JsonNode doc = get(base + enc(artifact) + "/versions/" + enc(selector) + "/content", true);
            if (!doc.path("asyncapi").asText().matches("3\\.[01]\\..*")) throw new IllegalArgumentException("Supported AsyncAPI versions: 3.0.x, 3.1.x");
            for (JsonNode selected : api.path("messages")) {
                String channelKey = selected.path("channel").asText(), messageKey = selected.path("message").asText();
                String id = api.path("alias").asText() + "." + channelKey + "." + messageKey;
                String role = selected.path("role").asText();
                if (!Set.of("publish", "consume").contains(role) || !ids.add(id + ":" + role)) throw new IllegalArgumentException("Invalid or duplicate selection " + id);
                JsonNode channel = resolve(doc, doc.path("channels").path(channelKey));
                for (JsonNode serverRef : channel.path("servers")) {
                    String protocol = resolve(doc, serverRef).path("protocol").asText();
                    if (!protocol.equals("kafka") && !protocol.equals("kafka-secure")) throw new IllegalArgumentException("Kafka transport is required");
                }
                JsonNode messageRef = channel.path("messages").path(messageKey), message = resolve(doc, messageRef);
                if (!message.has("payload")) throw new IllegalArgumentException("Unknown message/payload " + id);
                JsonNode payload = resolve(doc, message.path("payload"));
                String format = payload.path("schemaFormat").asText("application/schema+json");
                boolean avro = format.startsWith("application/vnd.apache.avro;");
                if (!avro && !format.startsWith("application/schema+json") && !format.startsWith("application/vnd.aai.asyncapi+json")) throw new IllegalArgumentException("Unsupported schema format " + format);
                String identity = message.path("payload").path("$ref").asText(payload.path("schema").path("$ref").asText(messageRef.path("$ref").asText(channelKey + "/" + messageKey)));
                String schemaId = artifact + ".payload." + hash(identity).substring(0,24);
                ObjectNode defs = JSON.createObjectNode();
                JsonNode expected = bundle(doc, payload.has("schemaFormat") ? payload.path("schema") : payload, avro, defs, new HashMap<>());
                if (!defs.isEmpty()) ((ObjectNode)expected).set("$defs", defs);
                // Publication deduplicates unchanged schemas, so a payload need not have the contract's Git SHA version.
                // Locate the exact published content; never silently select a newer, different schema.
                JsonNode schemaMeta = null, schema = null;
                for (int offset = 0; schemaMeta == null; offset += 100) {
                    JsonNode page = get(base + enc(schemaId) + "/versions?limit=100&offset=" + offset, false);
                    for (JsonNode candidate : page.path("versions")) {
                        if (!candidate.path("state").asText("ENABLED").equals("ENABLED")) continue;
                        JsonNode content = get(base + enc(schemaId) + "/versions/" + enc(candidate.path("version").asText()) + "/content", false);
                        if (expected.equals(content)) { schemaMeta = candidate; schema = content; break; }
                    }
                    if (schemaMeta != null || page.path("versions").size() < 100) break;
                }
                if (schemaMeta == null) throw new IllegalStateException("No published schema matches selected contract: " + schemaId);
                String location = message.path("bindings").path("kafka").path("schemaIdLocation").asText("payload");
                if (!Set.of("header", "payload").contains(location)) throw new IllegalArgumentException("Unsupported schema ID location");
                String operation = selected.path("restOperation").asText("");
                if (!operation.isEmpty() && (!role.equals("publish") || !operations.add(operation))) throw new IllegalArgumentException("REST mapping must select one publisher per operation");
                String topic = channel.path("bindings").path("kafka").path("topic").asText(channel.path("address").asText());
                if (!topic.matches("[A-Za-z0-9._-]+")) throw new IllegalArgumentException("A concrete Kafka topic is required");
                JsonNode example = message.path("examples").path(0).path("headers");
                JsonNode headerSchema = resolve(doc, message.path("headers"));
                if (headerSchema.path("properties").has("ce_specversion") && (!example.hasNonNull("ce_type") || !example.hasNonNull("ce_source"))) throw new IllegalArgumentException("CloudEvents require ce_type and ce_source in a representative contract example");
                result.add(new Selection(id, role, operation, topic, group, schemaId,
                        schemaMeta.path("version").asText(), schemaMeta.path("globalId").asLong(), avro,
                        location.equals("header"), schema, message, example));
            }
        }
        return result;
    }
}
