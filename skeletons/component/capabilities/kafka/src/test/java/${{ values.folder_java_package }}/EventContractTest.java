package ${{ values.java_package }};

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import java.util.HashMap;

class EventContractTest {
    @Test
    void referencesResolveWithinTheContractAndRejectRemoteDocuments() throws Exception {
        var doc = EventContracts.JSON.readTree("{\"components\":{\"schemas\":{\"Id\":{\"type\":\"string\"}}}}");
        var ref = EventContracts.JSON.readTree("{\"$ref\":\"#/components/schemas/Id\"}");
        assertEquals("string", EventContracts.resolve(doc, ref).path("type").asText());
        assertThrows(IllegalArgumentException.class, () -> EventContracts.resolve(doc,
                EventContracts.JSON.readTree("{\"$ref\":\"https://example.invalid/schema\"}")));
        var defs = EventContracts.JSON.createObjectNode();
        var bundled = EventContracts.bundle(doc, ref, false, defs, new HashMap<>());
        assertTrue(bundled.path("$ref").asText().startsWith("#/$defs/ref_"));
        assertEquals(1, defs.size());
    }

    @Test
    void schemaIdentityUsesJsonEncodedReferenceRatherThanTopic() throws Exception {
        assertNotEquals(EventContracts.hash("#/components/schemas/OrderAcceptedPayload"),
                EventContracts.hash("#/components/schemas/OrderCancelledPayload"));
        assertEquals(64, EventContracts.hash("#/components/schemas/OrderAcceptedPayload").length());
    }
}
