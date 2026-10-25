#!/usr/bin/env python3
"""Plexo auto-organizer (Feature 1): sort finished files into category folders.

Modes:
  --dry-run --base-dir DIR --filename NAME   print where NAME would land as JSON
  --move PATH [--base-dir DIR]               move one finished file into its bucket
  --scan DIR                                 organize every loose file already in DIR

Collision rule mirrors src/main/download/paths.ts claimName: first free of
`name`, `name (1)`, `name (2)`, ..., with the last extension kept last
(`a.tar.gz` becomes `a.tar (1).gz`). Staging files (*.plexo) are never
touched. Torrents are out of scope: only single finished files are moved.
Stdlib only.
"""

import argparse
import json
import os
import shutil
import sys

DEFAULT_CATEGORIES = [
    {"id": "documents", "label": "Documents",
     "extensions": ["pdf", "doc", "docx", "txt", "md", "rtf", "odt",
                    "xls", "xlsx", "ppt", "pptx", "csv"]},
    {"id": "videos", "label": "Videos",
     "extensions": ["mp4", "mkv", "mov", "avi", "webm"]},
    {"id": "archives", "label": "Archives",
     "extensions": ["zip", "rar", "7z", "tar", "gz"]},
    {"id": "programs", "label": "Programs",
     "extensions": ["exe", "msi", "dmg", "deb", "rpm", "appimage"]},
    {"id": "others", "label": "Others", "extensions": []},
]


def extension_of(name):
    base = os.path.basename(name)
    if "." not in base or base.startswith(".") or base.endswith("."):
        return ""
    return base.rsplit(".", 1)[1].lower()


def pick_category(name, categories):
    ext = extension_of(name)
    cats = categories or DEFAULT_CATEGORIES
    for cat in cats:
        if ext in cat.get("extensions", []):
            return cat
    for cat in cats:
        if not cat.get("extensions"):
            return cat
    return cats[-1]


def safe_folder(raw, fallback_label):
    raw = (raw or "").strip()
    if not raw:
        return fallback_label
    if os.path.isabs(raw):
        if ".." in raw.split(os.sep):
            return fallback_label
        return raw
    if raw in (".", "..") or len(raw) > 64:
        return fallback_label
    for ch in raw:
        if not (ch.isalnum() or ch in (" ", "_", "-", ".")):
            return fallback_label
    return raw


def target_dir(base_dir, name, categories):
    cat = pick_category(name, categories)
    folder = safe_folder(cat.get("folder", ""), cat["label"])
    path = folder if os.path.isabs(folder) else os.path.join(base_dir, folder)
    return path, cat["id"], cat["label"]


def free_name(directory, name):
    # As paths.ts claimName: only the last extension is kept last, and an
    # over-long "extension" is treated as part of the name. ".gitignore" and
    # "archive." have no extension, as upstream.
    stem, ext = os.path.splitext(name)
    if not ext or len(ext.encode("utf-8")) > 32:
        stem, ext = name, ""
    candidate = os.path.join(directory, name)
    counter = 0
    while os.path.exists(candidate):
        counter += 1
        candidate = os.path.join(directory, "%s (%d)%s" % (stem, counter, ext))
        if counter > 10000:
            raise RuntimeError("no free name for %s" % name)
    return candidate


def load_categories(path):
    if not path:
        return DEFAULT_CATEGORIES
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    cats = data.get("categories", data) if isinstance(data, dict) else data
    out = []
    for entry in cats:
        out.append({"id": str(entry["id"]), "label": str(entry["label"]),
                    "extensions": [str(e).lower() for e in entry.get("extensions", [])],
                    "folder": str(entry.get("folder", ""))})
    return out or DEFAULT_CATEGORIES


def main(argv=None):
    ap = argparse.ArgumentParser(description="Plexo auto-organizer")
    ap.add_argument("--base-dir", default=".")
    ap.add_argument("--filename", default="")
    ap.add_argument("--config", default="")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--move", default="")
    ap.add_argument("--scan", default="")
    args = ap.parse_args(argv)

    categories = load_categories(args.config)

    if args.dry_run:
        if not args.filename:
            print(json.dumps({"error": "filename required"}))
            return 2
        path, cid, label = target_dir(os.path.abspath(args.base_dir),
                                      args.filename, categories)
        print(json.dumps({"finalPath": os.path.join(path, args.filename),
                          "category": cid, "label": label}))
        return 0

    if args.move:
        src = os.path.abspath(args.move)
        if src.endswith(".plexo") or not os.path.isfile(src):
            print(json.dumps({"error": "not a finished file"}))
            return 2
        base = os.path.abspath(args.base_dir)
        path, cid, label = target_dir(base, os.path.basename(src), categories)
        os.makedirs(path, exist_ok=True)
        dest = free_name(path, os.path.basename(src))
        if os.path.abspath(dest) == src:
            print(json.dumps({"finalPath": src, "category": cid,
                              "label": label, "moved": False}))
            return 0
        shutil.move(src, dest)
        print(json.dumps({"finalPath": dest, "category": cid,
                          "label": label, "moved": True}))
        return 0

    if args.scan:
        base = os.path.abspath(args.scan)
        moved = []
        for name in sorted(os.listdir(base)):
            full = os.path.join(base, name)
            if not os.path.isfile(full) or name.endswith(".plexo"):
                continue
            path, cid, label = target_dir(base, name, categories)
            os.makedirs(path, exist_ok=True)
            dest = free_name(path, name)
            if os.path.abspath(dest) == full:
                continue
            shutil.move(full, dest)
            moved.append({"from": full, "to": dest, "category": cid})
        print(json.dumps({"moved": moved, "count": len(moved)}))
        return 0

    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
