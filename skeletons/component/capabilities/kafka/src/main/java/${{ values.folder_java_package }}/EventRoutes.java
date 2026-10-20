package ${{ values.java_package }};

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import org.apache.camel.Exchange;
import org.apache.camel.builder.RouteBuilder;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.header.internals.RecordHeaders;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.eclipse.microprofile.config.ConfigProvider;
import org.jboss.logging.Logger;

@ApplicationScoped
public class EventRoutes extends RouteBuilder {
    private static final Logger LOG = Logger.getLogger(EventRoutes.class);
    private final List<EventCodec> codecs = new ArrayList<>();
    private KafkaProducer<String,byte[]> producer;

    @Override
    public void configure() throws Exception {
        var config = ConfigProvider.getConfig();
        if (!config.getOptionalValue("events.enabled", Boolean.class).orElse(true)) return;
        String registry = config.getValue("events.registry.url", String.class);
        String brokers = config.getValue("kafka.bootstrap.servers", String.class);
        var declarations = EventContracts.JSON.readTree(getClass().getResourceAsStream("/event-contracts.json"));
        var selected = new EventContracts(registry).load(declarations);
        Map<String,List<EventCodec>> consumers = new LinkedHashMap<>();
        Properties props = new Properties();
        props.put("bootstrap.servers", brokers);
        props.put("key.serializer", StringSerializer.class.getName());
        props.put("value.serializer", ByteArraySerializer.class.getName());
        props.put("acks", "all");
        props.put("enable.idempotence", "true");
        props.put("max.block.ms", "15000");
        producer = new KafkaProducer<>(props);
        for (var selection : selected) {
            EventCodec codec = new EventCodec(selection, registry);
            codecs.add(codec);
            if (selection.role().equals("publish")) {
                from("direct:events." + selection.id()).routeId("publish-" + selection.id())
                        .process(exchange -> publish(codec, exchange));
                if (!selection.restOperation().isEmpty()) {
                    {%- if values.provided_api %}
                    var spec = EventContracts.YAML.readTree(getClass().getResourceAsStream("/${{ values.provided_api.contract_file }}"));
                    boolean found = false;
                    for (var path : spec.path("paths")) for (var operation : path)
                        if (operation.path("operationId").asText().equals(selection.restOperation())) found = true;
                    if (!found) throw new IllegalArgumentException("Unknown provided OpenAPI operation " + selection.restOperation());
                    from("direct:" + selection.restOperation()).routeId("rest-publish-" + selection.id())
                            .to("direct:events." + selection.id());
                    {%- else %}
                    throw new IllegalArgumentException("REST operation mapping requires a provided OpenAPI contract");
                    {%- endif %}
                } else {
                    // A documented JSON ingress makes an event-only publisher immediately usable.
                    from("platform-http:/events/" + selection.id() + "?httpMethodRestrict=POST")
                            .routeId("ingress-" + selection.id()).convertBodyTo(String.class)
                            .to("direct:events." + selection.id());
                }
            } else consumers.computeIfAbsent(selection.topic(), key -> new ArrayList<>()).add(codec);
        }
        for (var entry : consumers.entrySet()) {
            from("kafka:" + entry.getKey() + "?brokers=" + brokers
                    + "&groupId=${{ values.java_package }}&autoOffsetReset=earliest"
                    + "&valueDeserializer=org.apache.kafka.common.serialization.ByteArrayDeserializer")
                    .routeId("consume-" + entry.getKey()).process(exchange -> {
                        byte[] bytes = exchange.getMessage().getBody(byte[].class);
                        RecordHeaders headers = new RecordHeaders();
                        exchange.getMessage().getHeaders().forEach((key, value) -> {
                            if (value instanceof byte[]) headers.add(key, (byte[])value);
                            else if (value instanceof String) headers.add(key, ((String)value).getBytes(StandardCharsets.UTF_8));
                        });
                        try {
                            EventCodec codec = entry.getValue().stream().filter(c -> c.matches(headers, bytes)).findFirst()
                                    .orElseThrow(() -> new IllegalArgumentException("Unselected or missing schema identity"));
                            Object payload = codec.decode(headers, bytes);
                            // Replace this handler with application behavior. No payload data is logged.
                            LOG.infof("EVENT_HANDLED selection=%s topic=%s schema=%s/%s version=%s eventId=%s",
                                    codec.selected.id(), entry.getKey(), codec.selected.group(), codec.selected.artifact(),
                                    codec.selected.version(), EventCodec.header(headers, "ce_id"));
                            exchange.getMessage().setBody(payload);
                        } catch (Exception error) {
                            // Deliberate reject-and-continue policy prevents poison records blocking the partition.
                            LOG.warnf("EVENT_REJECTED topic=%s reason=%s", entry.getKey(), error.getClass().getSimpleName());
                        }
                    });
        }
    }
    private void publish(EventCodec codec, Exchange exchange) throws Exception {
        var headers = codec.headers();
        Object body = exchange.getMessage().getBody();
        String json = body instanceof String ? (String)body : body instanceof byte[]
                ? new String((byte[])body, StandardCharsets.UTF_8) : EventContracts.JSON.writeValueAsString(body);
        byte[] bytes = codec.encode(json, headers);
        var result = producer.send(new ProducerRecord<>(codec.selected.topic(), null, null, null, bytes, headers)).get(30, TimeUnit.SECONDS);
        exchange.getMessage().setHeader(Exchange.CONTENT_TYPE, "application/json");
        var response = Map.of("topic", result.topic(), "partition", result.partition(),
                "offset", result.offset(), "eventId", EventCodec.header(headers, "ce_id"));
        exchange.getMessage().setBody(codec.selected.restOperation().isEmpty()
                ? EventContracts.JSON.writeValueAsString(response) : response);
    }
    @PreDestroy
    void closeClients() {
        if (producer != null) producer.close();
        codecs.forEach(EventCodec::close);
    }
}
