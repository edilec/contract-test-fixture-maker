# Contract Test Fixture Maker

An offline generator of deterministic, **synthetic** contract examples. It reads a supported field-constraint schema, writes one valid record plus one-case-at-a-time invalid records, and labels each case by the rule it is meant to exercise. It does not read production records, fetch schemas, execute contracts, or call a service.

## Run

Node.js 22+; no runtime dependencies. From this repository:

```sh
node examples/run.mjs passing   # exit 0, writes only to a disposable temporary directory
node examples/run.mjs failing   # exit 1, contradictory schema constraints
npm run check
```

For your own schema: `node bin/contract-test-fixture-maker.mjs --root DIR --schema schema.json --seed 7 --out fixtures.json`. Paths are relative to the real `--root`. The output parent must exist. `--out` may overwrite an unrelated ordinary file, but it cannot be a symlink, leave the root through a symlinked parent, or share an inode with the schema input. Use only schemas/field names you are authorized to process; no source values are accepted.

`stdout` is one JSON report; `stderr` is a brief operational summary. Exit `0` means cases were generated, `1` means a fully read schema has mutually impossible constraints, and `2` means configuration error, incomplete/unsupported evidence, a limit, or an unsafe/unwritable output. Configuration errors (including invalid root, seed, and destination) have empty stdout; unreadable or malformed schema inputs emit an incomplete report. No file is written unless the report passes.

## Input and output

The schema is strict UTF-8 JSON, version `1`, with `complete:true` and 1–20 fields. A field has a unique ASCII name (`[a-z][a-z0-9_]*`, up to 32 characters), `required` boolean, and one of:

| Type | Required constraint keys | Range | Generated invalid rules |
| --- | --- | --- | --- |
| `string` | `minLength`, `maxLength` | integer 0–32, min ≤ max | `required` when required; `type`; `min-length` when min > 0; `max-length` |
| `integer` | `minimum`, `maximum` | integer −1000–1000, min ≤ max | `required` when required; `type`; `minimum`; `maximum` |

Unknown keys, missing completeness, duplicate JSON keys (including escaped equivalents), unsupported types and empty field lists are incomplete; contradictory bounds are failures. Only UTF-16 code-unit string length and safe integers are modeled. The generated file has `schemaVersion`, `seed`, and ordered `cases` with `expectedRule`, `fieldOrdinal`, and `record`. It uses the seed and simple pseudorandom letters/numbers, never exemplar values. A generated invalid case changes exactly one field of the valid record. A consumer should independently validate cases against its own contract implementation, as the tests do; the labels themselves are not proof.

## Report rules

The report uses logical provenance `@schema` plus a JSON Pointer; no host path or source value is echoed. Findings sort by `(file, pointer, ruleId)` using code-unit order. Severity is fixed:

| Rule | Severity | Meaning |
| --- | --- | --- |
| `constraint-conflict` | error | Supported constraints cannot be met |
| `schema-invalid` | warning | Missing, partial, duplicate, or unsupported schema evidence |
| `input-unreadable` | warning | Schema file cannot be read, decoded, or parsed |
| `limit-exceeded` | warning | Documented size, depth, count, or time bound exceeded |

Warnings make status `incomplete`, never `pass`. The report includes `summary.checked` (fields) and `summary.cases` (generated cases), with errors/warnings counts. Fixed messages and ordinal/pointer locations avoid disclosing source content.

## Limits and non-goals

Schema bytes ≤65,536; fields ≤20; JSON depth ≤16 (root depth 0); seed 0–4,294,967,295; field name length ≤32; generation deadline 5,000 ms via an injectable clock. Every boundary has an exact-limit and over-limit test. Time and memory spent by Node's built-in `JSON.parse` are not preemptible; the byte cap keeps that parser input small. This is a small supported-schema generator, not JSON Schema/OpenAPI/Avro support, a fuzzing engine, a validator for arbitrary schemas, a privacy scrubber, or a production-data sampler. It never uses the network.
