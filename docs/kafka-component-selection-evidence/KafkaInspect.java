import java.time.Duration;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.clients.producer.*;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.Headers;
import org.apache.kafka.common.header.internals.RecordHeaders;
import io.apicurio.registry.serde.avro.AvroKafkaDeserializer;
import io.apicurio.registry.serde.jsonschema.JsonSchemaKafkaDeserializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;

/** Independent wire inspector; does not call generated application codecs. */
public class KafkaInspect {
 static String text(Headers h,String k){var v=h.lastHeader(k);return v==null?"":new String(v.value(),StandardCharsets.UTF_8);}
 public static void main(String[] args) throws Exception {
  String brokers=args[0], registry=args[1], mode=args.length>2?args[2]:"inspect";
  Properties p=new Properties();p.put("bootstrap.servers",brokers);p.put("group.id","wire-verification-"+UUID.randomUUID());p.put("enable.auto.commit","false");p.put("key.deserializer","org.apache.kafka.common.serialization.StringDeserializer");p.put("value.deserializer","org.apache.kafka.common.serialization.ByteArrayDeserializer");
  Map<String,Object> serde=new HashMap<>();serde.put("apicurio.registry.url",registry);serde.put("apicurio.registry.headers.enabled",true);serde.put("apicurio.registry.serde.validation-enabled",true);serde.put("apicurio.registry.serde.read-type-ref",false);serde.put("apicurio.registry.deserializer.value.return-class",JsonNode.class.getName());
  var avro=new AvroKafkaDeserializer<Object>();var json=new JsonSchemaKafkaDeserializer<Object>();avro.configure(serde,false);json.configure(serde,false);
  var mapper=new ObjectMapper();List<Map<String,Object>> observations=new ArrayList<>();ConsumerRecord<String,byte[]> accepted=null,shipment=null;
  try(var consumer=new KafkaConsumer<String,byte[]>(p)){
   List<TopicPartition> partitions=new ArrayList<>();for(String topic:List.of("ux.parcels","ux.shipments"))for(var part:consumer.partitionsFor(topic,Duration.ofSeconds(15)))partitions.add(new TopicPartition(topic,part.partition()));
   consumer.assign(partitions);consumer.seekToBeginning(partitions);
   long until=System.currentTimeMillis()+15000;
   while(System.currentTimeMillis()<until){for(var r:consumer.poll(Duration.ofSeconds(1))){
    Map<String,Object> row=new LinkedHashMap<>();row.put("topic",r.topic());row.put("partition",r.partition());row.put("offset",r.offset());row.put("wireBytes",r.value().length);
    Map<String,String> headers=new LinkedHashMap<>();for(var h:r.headers())headers.put(h.key(),h.key().equals("apicurio.value.globalId")?String.valueOf(ByteBuffer.wrap(h.value()).getLong()):new String(h.value(),StandardCharsets.UTF_8));row.put("headers",headers);
    try {Object decoded=text(r.headers(),"content-type").equals("application/avro")?avro.deserialize(r.topic(),r.headers(),r.value()):json.deserialize(r.topic(),r.headers(),r.value());row.put("payload",mapper.readTree(decoded.toString()));row.put("valid",true);
     if(text(r.headers(),"ce_type").equals("demo.order.accepted")&&text(r.headers(),"ce_specversion").equals("1.0"))accepted=r;
     if(text(r.headers(),"ce_type").equals("demo.shipment.dispatched"))shipment=r;
    } catch(Exception e){row.put("valid",false);row.put("error",e.getClass().getSimpleName());}
    observations.add(row);
   }}
  }
  if(mode.equals("inject")){
   if(accepted==null||shipment==null)throw new IllegalStateException("Need valid Avro and JSON records before injecting errors");
   Properties out=new Properties();out.put("bootstrap.servers",brokers);out.put("key.serializer","org.apache.kafka.common.serialization.StringSerializer");out.put("value.serializer","org.apache.kafka.common.serialization.ByteArraySerializer");out.put("acks","all");
   try(var producer=new KafkaProducer<String,byte[]>(out)){
    for(var r:List.of(accepted,shipment)){
     var h=new RecordHeaders(r.headers().toArray());h.remove("ce_id");h.add("ce_id",("malformed-"+UUID.randomUUID()).getBytes(StandardCharsets.UTF_8));
     byte[] invalid=r==accepted?new byte[]{127}:"{\"orderId\":42}".getBytes(StandardCharsets.UTF_8);
     var ack=producer.send(new ProducerRecord<>(r.topic(),null,null,null,invalid,h)).get();System.out.println("INJECTED_INVALID_PAYLOAD "+ack.topic()+" "+ack.offset());
    }
    var h=new RecordHeaders(accepted.headers().toArray());h.remove("ce_specversion");h.add("ce_specversion","0.3".getBytes(StandardCharsets.UTF_8));
    var ack=producer.send(new ProducerRecord<>(accepted.topic(),null,null,null,accepted.value(),h)).get();System.out.println("INJECTED_INVALID_CLOUDEVENT "+ack.topic()+" "+ack.offset());
   }
  }
  System.out.println("WIRE_RECORDS="+mapper.writeValueAsString(observations));avro.close();json.close();
 }
}
