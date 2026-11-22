#!/usr/bin/env python3
"""
Local E-Book Library Indexer (Cross-Platform: Linux, macOS, Windows)

Automatically scans the parent directory containing this project folder (all sibling
folders and files) as well as the project folder itself, excluding internal app/,
.github/, .git/, and .gitignore directories.

Uses incremental indexing: unchanged files reuse cached metadata (including EPUB
metadata), only new or modified files are parsed, and deleted files are removed.

Also generates app/data/books.js and app/lang/languages.js bridges so index.html works
directly over the file:// protocol without browser CORS errors or a local server.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

DEFAULT_EXTENSIONS = [
    ".pdf", ".epub", ".mobi", ".azw", ".azw3",
    ".djvu", ".fb2", ".cbr", ".cbz", ".txt", ".docx", ".rtf",
]

DEFAULT_EXCLUDES = [
    "$RECYCLE.BIN",
    "System Volume Information",
    ".git",
    ".github",
    ".gitignore",
    "node_modules",
    "AppData",
]

YEAR_END_RE = re.compile(r"[\(\[\s]((?:18|19|20)\d{2})[\)\]\s]?$")
YEAR_BRACKET_RE = re.compile(r"[\(\[]((?:18|19|20)\d{2})[\)\]]")
YEAR_ANY_RE = re.compile(r"((?:18|19|20)\d{2})")
AUTHOR_TITLE_RE = re.compile(r"^\s*(.+?)\s+-\s+(.+)\s*$")
HTML_TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")


def clean_whitespace(text: Optional[str]) -> str:
    if not text:
        return ""
    return WHITESPACE_RE.sub(" ", text).strip()


def get_stable_id(text: str) -> str:
    return hashlib.sha1(text.lower().encode("utf-8")).hexdigest()[:12]


def parse_filename_metadata(base_name: str) -> Dict[str, str]:
    clean = clean_whitespace(base_name.replace("_", " "))
    year = ""

    m = YEAR_END_RE.search(clean) or YEAR_BRACKET_RE.search(clean)
    if m:
        year = m.group(1)

    title = clean
    author = ""

    # Split "Author Name - Book Title" pattern
    at = AUTHOR_TITLE_RE.match(clean)
    if at:
        left = clean_whitespace(at.group(1))
        right = clean_whitespace(at.group(2))
        if left and not left.isdigit() and right:
            author = left
            title = right

    return {"title": title, "author": author, "year": year}


def _find_zip_entry(zf: zipfile.ZipFile, target_path: str) -> Optional[str]:
    norm_target = target_path.replace("\\", "/").lstrip("/")
    names = zf.namelist()
    if norm_target in names:
        return norm_target
    target_lower = norm_target.lower()
    for name in names:
        if name.replace("\\", "/").lstrip("/").lower() == target_lower:
            return name
    return None


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[1]
    return tag


def get_epub_metadata(file_path: Path) -> Optional[Dict[str, Any]]:
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            container_name = _find_zip_entry(zf, "META-INF/container.xml")
            if not container_name:
                return None

            container_xml = ET.fromstring(zf.read(container_name))
            opf_path = ""
            for elem in container_xml.iter():
                if _local_name(elem.tag) == "rootfile":
                    opf_path = elem.attrib.get("full-path", "").strip()
                    if opf_path:
                        break
            if not opf_path:
                return None

            opf_normalized = urllib.parse.unquote(opf_path).lstrip("/")
            opf_name = _find_zip_entry(zf, opf_normalized)
            if not opf_name:
                return None

            opf_xml = ET.fromstring(zf.read(opf_name))

            metadata_elem = None
            for elem in opf_xml.iter():
                if _local_name(elem.tag) == "metadata":
                    metadata_elem = elem
                    break
            if metadata_elem is None:
                return None

            title_text = ""
            authors: List[str] = []
            publisher_text = ""
            language_text = ""
            year_text = ""
            tags: List[str] = []
            description_text = ""

            for child in metadata_elem:
                lname = _local_name(child.tag)
                text = clean_whitespace("".join(child.itertext()))
                if not text:
                    continue

                if lname == "title" and not title_text:
                    title_text = text
                elif lname == "creator":
                    if text not in authors:
                        authors.append(text)
                elif lname == "publisher" and not publisher_text:
                    publisher_text = text
                elif lname == "language" and not language_text:
                    language_text = text.lower()
                elif lname == "date" and not year_text:
                    ym = YEAR_ANY_RE.search(text)
                    if ym:
                        year_text = ym.group(1)
                elif lname == "subject":
                    if len(text) <= 60 and text not in tags and len(tags) < 8:
                        tags.append(text)
                elif lname == "description" and not description_text:
                    plain = html.unescape(HTML_TAG_RE.sub(" ", "".join(child.itertext())))
                    plain = clean_whitespace(plain)
                    if len(plain) > 450:
                        plain = plain[:447].rstrip() + "..."
                    description_text = plain

            return {
                "title": title_text,
                "author": ", ".join(authors),
                "publisher": publisher_text,
                "language": language_text,
                "year": year_text,
                "tags": tags,
                "description": description_text,
            }
    except Exception:
        # Skip corrupted or DRM-protected EPUB files without aborting the scan
        return None


def write_utf8_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)


def sync_language_packs(app_dir: Path) -> None:
    lang_dir = app_dir / "lang"
    if not lang_dir.is_dir():
        return

    lang_files = sorted(
        p for p in lang_dir.iterdir()
        if p.is_file() and p.suffix.lower() == ".json" and p.name.lower() != "manifest.json"
    )

    packs: Dict[str, Any] = {}
    manifest_list: List[Dict[str, str]] = []

    for lf in lang_files:
        try:
            parsed = json.loads(lf.read_text(encoding="utf-8"))
            code = str(parsed.get("code") or lf.stem).strip().lower()
            if not code:
                continue

            name = str(parsed.get("name") or code.upper())
            locale = str(parsed.get("locale") or code)
            direction = str(parsed.get("dir") or "ltr")
            strings = parsed.get("strings") if isinstance(parsed.get("strings"), dict) else {}

            packs[code] = {
                "code": code,
                "name": name,
                "locale": locale,
                "dir": direction,
                "strings": strings,
            }
            manifest_list.append({
                "code": code,
                "name": name,
                "file": lf.name,
            })
        except Exception as exc:
            print(f"WARNING: Failed to parse language file ({lf.name}): {exc}", file=sys.stderr)

    manifest_json = json.dumps({"languages": manifest_list}, ensure_ascii=False, indent=2)
    write_utf8_text(lang_dir / "manifest.json", manifest_json)

    langs_json = json.dumps(packs, ensure_ascii=False, separators=(",", ":"))
    safe_langs_json = langs_json.replace("</script", r"<\/script")
    langs_js = (
        "// Auto-generated by index-ebooks.py from app/lang/*.json files.\n"
        f"window.EBOOK_LANGS = {safe_langs_json};\n"
    )
    write_utf8_text(lang_dir / "languages.js", langs_js)

    print(f"Language packs synced ({len(packs)} languages): {', '.join(packs.keys())}")


def get_files_safe(
    root_path: Path,
    ext_set: Set[str],
    exclude_set: Set[str],
    skip_dirs: List[Path],
) -> List[Path]:
    skip_norm = {os.path.normcase(os.path.normpath(str(p))) for p in skip_dirs}
    results: List[Path] = []
    stack: List[str] = [str(root_path)]

    while stack:
        current_dir = stack.pop()
        if os.path.normcase(os.path.normpath(current_dir)) in skip_norm:
            continue

        try:
            with os.scandir(current_dir) as it:
                entries = list(it)
        except OSError:
            print(f"WARNING: Could not read directory (access error): {current_dir}", file=sys.stderr)
            continue

        for entry in entries:
            try:
                if entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if entry.name.lower() in exclude_set:
                        continue
                    if os.path.normcase(os.path.normpath(entry.path)) in skip_norm:
                        continue
                    stack.append(entry.path)
                elif entry.is_file(follow_symlinks=False):
                    _, ext = os.path.splitext(entry.name)
                    if ext.lower() in ext_set:
                        results.append(Path(entry.path))
            except OSError:
                continue

    return results


def export_books_to_xml(db_object: Dict[str, Any], xml_path: Path) -> None:
    root = ET.Element(
        "library",
        attrib={
            "schemaVersion": str(db_object["schemaVersion"]),
            "generatedAt": str(db_object["generatedAt"]),
            "totalBooks": str(db_object["stats"]["totalBooks"]),
        },
    )
    books_el = ET.SubElement(root, "books")

    fields = [
        "title", "author", "fileName", "extension", "sizeBytes",
        "lastModified", "addedAt", "rootName", "subFolder", "folderPath",
        "fullPath", "fileUri", "year", "publisher", "language",
        "description", "metadataSource",
    ]

    for book in db_object["books"]:
        book_el = ET.SubElement(books_el, "book", attrib={"id": str(book.get("id", ""))})
        for key in fields:
            el = ET.SubElement(book_el, key)
            el.text = str(book.get(key, ""))
        tags_el = ET.SubElement(book_el, "tags")
        for tag in book.get("tags") or []:
            t_el = ET.SubElement(tags_el, "tag")
            t_el.text = str(tag)

    try:
        ET.indent(root, space="  ")  # Python 3.9+
    except AttributeError:
        pass

    xml_path.parent.mkdir(parents=True, exist_ok=True)
    tree = ET.ElementTree(root)
    tree.write(xml_path, encoding="utf-8", xml_declaration=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Index local e-book folders into a JSON (and optional XML) database."
    )
    parser.add_argument("--config", dest="config_path", default="", help="Path to config.json")
    parser.add_argument("--folders", nargs="+", default=None, help="Optional folders to scan")
    parser.add_argument("--force", action="store_true", help="Ignore cache and re-scan all files")
    parser.add_argument("--fast", action="store_true", help="Skip EPUB internal metadata parsing")
    parser.add_argument("--export-xml", action="store_true", help="Also export app/data/books.xml")
    parser.add_argument("--only-lang", action="store_true", help="Sync language packs only")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    script_dir = Path(__file__).resolve().parent
    app_dir = script_dir.parent
    project_root = app_dir.parent
    config_path = Path(args.config_path) if args.config_path else (app_dir / "config" / "config.json")

    # 0. Sync language packs
    sync_language_packs(app_dir)
    if args.only_lang:
        return 0

    # 1. Load configuration
    extensions = list(DEFAULT_EXTENSIONS)
    excludes = list(DEFAULT_EXCLUDES)
    extract_epub = True

    if config_path.is_file():
        try:
            cfg = json.loads(config_path.read_text(encoding="utf-8"))
            if isinstance(cfg.get("extensions"), list) and cfg["extensions"]:
                extensions = cfg["extensions"]
            if isinstance(cfg.get("excludeFolders"), list) and cfg["excludeFolders"]:
                excludes = cfg["excludeFolders"]
            if "extractEpubMetadata" in cfg:
                extract_epub = bool(cfg["extractEpubMetadata"])
        except Exception as exc:
            print(f"WARNING: Failed to read {config_path}: {exc}", file=sys.stderr)

    if args.fast:
        extract_epub = False

    ext_set: Set[str] = set()
    for ext in extensions:
        s = str(ext).strip().lower()
        if s:
            ext_set.add(s if s.startswith(".") else f".{s}")

    exclude_set: Set[str] = {str(ex).strip().lower() for ex in excludes if str(ex).strip()}

    # 2. Load existing database cache
    data_dir = app_dir / "data"
    json_path = data_dir / "books.json"
    js_path = data_dir / "books.js"
    xml_path = data_dir / "books.xml"

    existing_map: Dict[str, Dict[str, Any]] = {}
    if not args.force and json_path.is_file():
        try:
            old_db = json.loads(json_path.read_text(encoding="utf-8"))
            for b in old_db.get("books") or []:
                fp = str(b.get("fullPath") or "")
                if fp:
                    existing_map[os.path.normcase(os.path.normpath(fp))] = b
            print(f"Loaded existing database cache: {len(existing_map)} records.")
        except Exception as exc:
            print(f"WARNING: Could not read existing books.json; performing a full scan: {exc}", file=sys.stderr)
            existing_map = {}

    # 3. Resolve folders to scan
    start_time = time.monotonic()
    now_iso = datetime.datetime.now().astimezone().isoformat(timespec="seconds")

    internal_skip_dirs = [
        app_dir,
        project_root / ".github",
        project_root / ".git",
        project_root / ".gitignore",
    ]

    folders_to_scan: List[Path] = []
    if args.folders:
        for raw in args.folders:
            p = Path(raw).expanduser()
            if not p.is_dir():
                print(f"WARNING: Folder not found (skipped): {raw}", file=sys.stderr)
                continue
            resolved = p.resolve()
            if resolved not in folders_to_scan:
                folders_to_scan.append(resolved)
    else:
        parent_dir = project_root.parent
        auto_root = parent_dir if (parent_dir != project_root and parent_dir.is_dir()) else project_root
        folders_to_scan.append(auto_root.resolve())

    seen_paths: Set[str] = set()
    indexed_books: List[Dict[str, Any]] = []
    valid_scanned_folders: List[str] = []

    added_count = 0
    updated_count = 0
    unchanged_count = 0
    total_size_bytes = 0

    print("")
    print("=== E-Book Indexing Started ===")

    for full_root in folders_to_scan:
        root_str = str(full_root)
        root_name = full_root.name or root_str
        valid_scanned_folders.append(root_str)
        print(f"Scanning: {root_str}")

        files = get_files_safe(full_root, ext_set, exclude_set, internal_skip_dirs)
        folder_total = len(files)
        print(f"  -> Found {folder_total} e-book files.")

        for idx, file_path in enumerate(files, start=1):
            if folder_total >= 500 and (idx % 500 == 0 or idx == folder_total):
                pct = int((idx * 100) / folder_total)
                elapsed = time.monotonic() - start_time
                print(f"     Processing: {idx} / {folder_total} ({pct}%) - {elapsed:.1f}s")

            full_str = str(file_path)
            path_key = os.path.normcase(os.path.normpath(full_str))
            if path_key in seen_paths:
                continue
            seen_paths.add(path_key)

            try:
                st = file_path.stat()
            except OSError:
                continue

            size_bytes = int(st.st_size)
            total_size_bytes += size_bytes
            last_mod_iso = datetime.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%dT%H:%M:%S")

            parent_dir_path = file_path.parent
            try:
                rel_parent = parent_dir_path.relative_to(full_root)
                sub_folder = "" if str(rel_parent) == "." else str(rel_parent)
            except ValueError:
                sub_folder = ""

            ext_no_dot = file_path.suffix.lstrip(".").lower()
            cached = existing_map.get(path_key)

            if (
                cached is not None
                and int(cached.get("sizeBytes", -1)) == size_bytes
                and str(cached.get("lastModified", "")) == last_mod_iso
            ):
                record = {
                    "id": str(cached.get("id") or get_stable_id(full_str)),
                    "title": str(cached.get("title") or file_path.name),
                    "author": str(cached.get("author") or ""),
                    "fileName": file_path.name,
                    "extension": ext_no_dot,
                    "sizeBytes": size_bytes,
                    "lastModified": last_mod_iso,
                    "addedAt": str(cached.get("addedAt") or now_iso),
                    "rootFolder": root_str,
                    "rootName": root_name,
                    "subFolder": sub_folder,
                    "folderPath": str(parent_dir_path),
                    "fullPath": full_str,
                    "fileUri": file_path.resolve().as_uri(),
                    "year": str(cached.get("year") or ""),
                    "publisher": str(cached.get("publisher") or ""),
                    "language": str(cached.get("language") or ""),
                    "tags": list(cached.get("tags") or []),
                    "description": str(cached.get("description") or ""),
                    "metadataSource": str(cached.get("metadataSource") or "filename"),
                }
                indexed_books.append(record)
                unchanged_count += 1
                continue

            parsed = parse_filename_metadata(file_path.stem)
            title = parsed["title"]
            author = parsed["author"]
            year = parsed["year"]
            publisher = ""
            language = ""
            tags: List[str] = []
            description = ""
            meta_source = "filename"

            if extract_epub and ext_no_dot == "epub":
                epub_meta = get_epub_metadata(file_path)
                if epub_meta:
                    if epub_meta["title"]:
                        title = epub_meta["title"]
                    if epub_meta["author"]:
                        author = epub_meta["author"]
                    if epub_meta["year"]:
                        year = epub_meta["year"]
                    if epub_meta["publisher"]:
                        publisher = epub_meta["publisher"]
                    if epub_meta["language"]:
                        language = epub_meta["language"]
                    if epub_meta["tags"]:
                        tags = list(epub_meta["tags"])
                    if epub_meta["description"]:
                        description = epub_meta["description"]
                    meta_source = "epub"

            prev_added_at = str(cached.get("addedAt") or "") if cached else ""
            record = {
                "id": get_stable_id(full_str),
                "title": title,
                "author": author,
                "fileName": file_path.name,
                "extension": ext_no_dot,
                "sizeBytes": size_bytes,
                "lastModified": last_mod_iso,
                "addedAt": prev_added_at or now_iso,
                "rootFolder": root_str,
                "rootName": root_name,
                "subFolder": sub_folder,
                "folderPath": str(parent_dir_path),
                "fullPath": full_str,
                "fileUri": file_path.resolve().as_uri(),
                "year": year,
                "publisher": publisher,
                "language": language,
                "tags": tags,
                "description": description,
                "metadataSource": meta_source,
            }
            indexed_books.append(record)

            if cached is not None:
                updated_count += 1
            else:
                added_count += 1

    removed_count = sum(1 for k in existing_map if k not in seen_paths)

    db_object = {
        "schemaVersion": 1,
        "generatedAt": now_iso,
        "stats": {
            "totalBooks": len(indexed_books),
            "totalSizeBytes": total_size_bytes,
            "added": added_count,
            "updated": updated_count,
            "removed": removed_count,
            "unchanged": unchanged_count,
            "scannedFolders": valid_scanned_folders,
        },
        "books": indexed_books,
    }

    # 4. Write database files
    print("Writing database files...")
    json_text = json.dumps(db_object, ensure_ascii=False, separators=(",", ":"))
    write_utf8_text(json_path, json_text)

    safe_js_json = json_text.replace("</script", r"<\/script")
    js_content = f"// Auto-generated by index-ebooks.py.\nwindow.EBOOK_DB = {safe_js_json};\n"
    write_utf8_text(js_path, js_content)

    if args.export_xml:
        export_books_to_xml(db_object, xml_path)

    total_elapsed = time.monotonic() - start_time
    print("")
    print(f"=== Indexing Completed ({total_elapsed:.2f}s) ===")
    print(f"  Total Books : {len(indexed_books)}")
    print(f"  Added       : {added_count}")
    print(f"  Updated     : {updated_count}")
    print(f"  Removed     : {removed_count}")
    print(f"  Unchanged   : {unchanged_count}")
    print(f"  JSON Output : {json_path}")
    print(f"  JS Bridge   : {js_path}")
    if args.export_xml:
        print(f"  XML Output  : {xml_path}")

    if not valid_scanned_folders:
        print("\nWARNING: No valid folders were found to scan.", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
