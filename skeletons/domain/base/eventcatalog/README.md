# Domain EventCatalog

Run `npm ci`, `npm run discover`, `npm run generate`, and `npm run build` from this
folder. Discovery follows Domain System activation files and System API values,
fetching their specified Git revisions. `.discovery.json` records resolved SHAs.
No contract inventory or generated schemas are maintained here.

Maintain architectural context in `docs/`. Native AsyncAPI generation writes only
ignored build resources and preserves authored documentation. Empty Domains still
serve their authored documentation.

EventCatalog 5.4.1 uses BSL 1.1; the official AsyncAPI generator 7.1.0 is MIT.
This reference architecture uses synthetic, non-production data. Enterprise
production use may require a commercial license. Package license notices are
preserved by npm; see `LICENSES/` in the published application.

Native generator 7.1.0 represents contracts as Services beneath a Domain and does
not create native System resources. Contract Service names and summaries retain
the source System and owner; Git remains the authority for System membership.
These Services do not imply deployed Components. Native sends/receives describe
the contract operations, not verified implementation relationships.
