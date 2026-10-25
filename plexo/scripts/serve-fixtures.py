#!/usr/bin/env python3
"""Serve plexo/test-fixtures/ on http://127.0.0.1:8123 with stable URLs.

Usage:
    python3 scripts/serve-fixtures.py [--port 8123] [--dir test-fixtures]

Every run serves byte-identical files (see TEST-FIXTURES.md). Range requests
are supported by http.server, so Plexo probes 206 paths exactly like the web.
Stdlib only.
"""

import argparse
import functools
import http.server
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def main():
    ap = argparse.ArgumentParser(description="Serve Plexo test fixtures")
    ap.add_argument("--port", type=int, default=8123)
    ap.add_argument("--dir", default=os.path.join(ROOT, "test-fixtures"))
    args = ap.parse_args()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler,
                                directory=os.path.abspath(args.dir))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print("fixtures: %s" % os.path.abspath(args.dir))
    print("  PDF: http://127.0.0.1:%d/sample.pdf" % args.port)
    print("  MP4: http://127.0.0.1:%d/sample.mp4" % args.port)
    print("  ZIP: http://127.0.0.1:%d/sample.zip" % args.port)
    server.serve_forever()


if __name__ == "__main__":
    main()
