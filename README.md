# Event Contracts

A TypeScript validator and migration CLI for versioned `order.placed` events. It turns legacy totals and newer line-item events into a common contract, rejects incompatible data, and detects conflicting replays of event IDs.

```sh
npm ci
npm test
node dist/cli.js --help
node dist/cli.js fixtures/orders.jsonl > canonical.jsonl
```

Requires Node.js 20 or later. The TypeScript compiler and Node types are development dependencies; runtime code uses only Node's built-ins. `npm test` compiles the TypeScript before running the tests.

The fixture contains three authored JSONL records with fictional identifiers: a v1 event, a v2 event and an exact replay. The command emits two v3 records and reports `read: 3, emitted: 2, duplicate: 1, rejected: 0` to standard error.

| Version | Source fields | Upcast decision |
|---|---|---|
| 1 | Customer email and integer total | Preserve email identity and total; set unknown line items to null |
| 2 | Customer ID and item quantities/prices | Preserve ID identity; derive total using exact integer arithmetic |
| 3 | Canonical customer, total and nullable items | Validate again; reconcile supplied item totals |

Contracts reject unknown and missing fields. Timestamps require valid UTC ISO form with milliseconds, for example `2026-01-15T10:00:00.000Z`. Money is stored as nonnegative integer minor units, with overflow checked through BigInt before converting to a safe JavaScript integer. Currency codes have a three-uppercase-letter shape; this does not validate an official currency register. Email validation checks shape, not deliverability.

Deduplication compares canonical event values, including item order, and retains up to 100,000 unique IDs in memory. The same ID with different canonical data fails. `--skip-invalid` continues past rejected records, including conflicts, and reports their count; it does not silently overwrite earlier events. Without it, the first failure exits 2. Success exits 0. Output is incremental, so failures can follow already-emitted records. A JSONL record above 1 MiB is rejected after it is read; this is not a hardened network parser.

No broker, registry, database, schema inference or API is required. This project demonstrates explicit migrations rather than claiming a migration is safe for arbitrary business data. Legacy line items cannot be reconstructed from a total. Canonical output can contain the source email, so use appropriate handling for real customer data.
