"""Verify saved producer acknowledgments, independently decoded wire records, and handler logs."""
import json
from pathlib import Path
root = Path(__file__).parent
published = json.loads((root / 'published-messages.json').read_text())
records = json.loads((root / 'kafka-wire-records.json').read_text())
registry = json.loads((root / 'registry-microcks.json').read_text())
logs = (root / 'handler.txt').read_text()
assert len(published) == len(records) == 4
schema_ids = {v['globalId'] for a in registry['artifacts'] if a['artifactType'] in ['AVRO', 'JSON'] for v in a['versions']}
assert len(schema_ids) == 3
seen = set()
for sent in published:
    ack = sent['ack']
    matches = [r for r in records if r['headers']['ce_id'] == ack['eventId']]
    assert len(matches) == 1
    record = matches[0]
    assert record['valid'] and record['payload'] == sent['payload']
    assert all(record[k] == ack[k] for k in ['topic', 'partition', 'offset'])
    assert record['headers']['ce_specversion'] == '1.0'
    expected = {'orders.accepted': ('demo.order.accepted', '/orders'), 'audit.accepted': ('demo.order.accepted', '/orders'), 'orders.cancelled': ('demo.order.cancelled', '/orders'), 'shipments.dispatched': ('demo.shipment.dispatched', '/shipments')}[sent['selection']]
    assert (record['headers']['ce_type'], record['headers']['ce_source']) == expected
    schema_id = int(record['headers']['apicurio.value.globalId'])
    assert schema_id in schema_ids
    seen.add(schema_id)
    assert any('EVENT_HANDLED' in line and ack['eventId'] in line for line in logs.splitlines())
assert seen == schema_ids
assert 'EVENT_REJECTED' not in logs
assert not any(' ERROR ' in line for line in logs.splitlines())
print('Verified 4 acknowledged records, 3 schema identities, exact decoded payloads, CloudEvents, and 4 handler event IDs.')

sender_logs = (root / 'sender.txt').read_text()
assert not any(' ERROR ' in line or 'EVENT_REJECTED' in line for line in sender_logs.splitlines())
