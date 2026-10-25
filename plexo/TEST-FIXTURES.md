# Plexo test fixtures (standard set, stable from now on)

Three tiny deterministic files. Same bytes on every machine, so organize
results and hashes stay comparable across testers.

| File | Size | Seed | Default bucket | SHA-256 (prefix) |
| ---- | ---- | ---- | -------------- | ---------------- |
| `sample.pdf` | 10 KiB | 11 | Documents | `d92cc470…` |
| `sample.mp4` | 200 KiB | 22 | Videos | `a510a5bf…` |
| `sample.zip` | 50 KiB | 33 | Archives | `6658e12b…` |

Full hashes: `test-fixtures/SHA256SUMS`. Verify with:

```bash
cd test-fixtures && sha256sum -c SHA256SUMS
```

Regenerate byte-identically with:

```bash
python3 scripts/make-fixtures.py
```

## Serve locally (canonical test URLs)

```bash
python3 scripts/serve-fixtures.py
# PDF: http://127.0.0.1:8123/sample.pdf
# MP4: http://127.0.0.1:8123/sample.mp4
# ZIP: http://127.0.0.1:8123/sample.zip
```

Payloads are opaque test bytes keyed by extension (organize sorts by
suffix, not content). They are not playable media.

## Internet copy

Planned: upload this pack as a GitHub release asset on the course fork so
professor demos work without a local server. Until then, these fallbacks:

- PDF: `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf`
- MP4: `https://download.samplelib.com/mp4/sample-5s.mp4`
