#!/usr/bin/env python3
"""Regenerate plexo/test-fixtures/ deterministically (xorshift32, fixed seeds).

Usage:
    python3 scripts/make-fixtures.py

Output: sample.pdf (10 KiB, seed 11), sample.mp4 (200 KiB, seed 22),
sample.zip (50 KiB, seed 33), plus SHA256SUMS. Payloads are opaque test
bytes keyed by extension (organize sorts by suffix, not content), so they
are not playable media. Verify with: (cd test-fixtures && sha256sum -c SHA256SUMS)
"""

import hashlib
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "test-fixtures")

SPECS = [("sample.pdf", 10 * 1024, 11),
         ("sample.mp4", 200 * 1024, 22),
         ("sample.zip", 50 * 1024, 33)]


def seeded(size, seed):
    buf = bytearray(size)
    state = seed & 0xFFFFFFFF or 1
    for i in range(size):
        state ^= (state << 13) & 0xFFFFFFFF
        state ^= state >> 17
        state ^= (state << 5) & 0xFFFFFFFF
        buf[i] = state & 0xFF
    return bytes(buf)


def main():
    os.makedirs(OUT, exist_ok=True)
    lines = []
    for name, size, seed in SPECS:
        data = seeded(size, seed)
        with open(os.path.join(OUT, name), "wb") as fh:
            fh.write(data)
        lines.append(hashlib.sha256(data).hexdigest() + "  " + name)
    with open(os.path.join(OUT, "SHA256SUMS"), "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
