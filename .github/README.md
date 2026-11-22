# Local E-Book Library Indexer & Web Search

Index thousands of e-books spread across multiple local folders into a single JSON (and optional XML) database using a zero-dependency PowerShell script, then search and browse them instantaneously through an offline HTML/CSS/JavaScript web interface.

No web server, database engine, folder configuration, or internet connection required.

## Features

- **Zero-configuration automatic scanning**: Place this folder inside your main e-books directory and run `update-index.bat` — it automatically scans every sibling folder at the same level as well as books inside this folder itself (while excluding `app/`, `.github/`, `.git/`, and `.gitignore`).
- **Incremental updates**: Unchanged files reuse cached metadata; only new, modified, or deleted books are processed.
- **Native EPUB metadata extraction**: Reads title, author, publisher, year, language, tags, and description directly from `.epub` archives without external tools.
- **Filename parsing fallback**: Extracts author, title, and year from filenames (e.g. `Author - Title (2020).pdf`) for PDF, MOBI, AZW3, DJVU, FB2, CBR/CBZ, TXT, DOCX, and RTF files.
- **Zero-server `file://` compatibility**: Automatically generates `app/data/books.js` and `app/lang/languages.js` bridges alongside the JSON files so double-clicking `index.html` works out of the box without browser CORS errors.
- **Fast offline web UI**: Instant multi-word diacritic-insensitive search, format filters, folder filters, sorting, Grid/List views, Light/Dark theme, book detail modal, and one-click path copying.
- **Multi-language UI (`app/lang/`)**: Ships with 19 built-in language packs (including RTL support for Arabic and Urdu) and automatically discovers any new `app/lang/*.json` file.

## Project Structure

```text
.
├── index.html                        # Main offline web interface
├── update-index.bat                  # Double-click launcher for Windows
├── LICENSE                           # MIT License
├── .gitignore                        # Git ignore rules
├── .github/
│   └── README.md                     # Documentation (rendered automatically on GitHub)
└── app/
    ├── assets/
    │   ├── app.js                    # Client-side search, filtering, and i18n logic
    │   └── styles.css                # Responsive light/dark theme stylesheet
    ├── config/
    │   └── config.json               # Supported extensions & excluded folder names
    ├── data/
    │   ├── books.json                # Generated UTF-8 JSON database (gitignored)
    │   └── books.js                  # Generated file:// database bridge (gitignored)
    ├── lang/
    │   ├── en.json                   # English language pack
    │   ├── tr.json                   # Turkish language pack
    │   ├── ...                       # 17 additional language packs
    │   ├── manifest.json             # Auto-generated language list
    │   └── languages.js              # Auto-generated file:// language bridge
    └── scripts/
        └── index-ebooks.ps1          # Main PowerShell indexing & language-sync script
```

## Quick Start

1. **Place this folder inside your e-books directory**  
   For example, if your e-books are in `D:\E-Books\Sci-Fi`, `D:\E-Books\History`, etc., place this project folder at `D:\E-Books\index` (or `D:\E-Books\local-ebook-library`).  
   `update-index.bat` automatically scans `D:\E-Books` (all sibling folders + inside the project folder itself), skipping `app/`, `.github/`, `.git/`, and `.gitignore`.

2. **Build or update the database**  
   - **Easiest way:** Double-click `update-index.bat`.
   - **PowerShell CLI options:**
     ```powershell
     # Standard incremental update (scans parent directory automatically)
     powershell -ExecutionPolicy Bypass -File .\app\scripts\index-ebooks.ps1

     # Also export app/data/books.xml
     powershell -ExecutionPolicy Bypass -File .\app\scripts\index-ebooks.ps1 -ExportXml

     # Force a full metadata re-scan from scratch
     powershell -ExecutionPolicy Bypass -File .\app\scripts\index-ebooks.ps1 -Force

     # Fast filename-only scan (skip reading inside EPUB files)
     powershell -ExecutionPolicy Bypass -File .\app\scripts\index-ebooks.ps1 -Fast

     # Optional: scan custom folders via CLI override
     powershell -ExecutionPolicy Bypass -File .\app\scripts\index-ebooks.ps1 -Folders "C:\Books","D:\PDF"

     # Sync language packs only (without scanning books)
     powershell -ExecutionPolicy Bypass -File .\app\scripts\index-ebooks.ps1 -OnlyLang
     ```

3. **Browse & search**  
   Double-click `index.html` to open it in your browser. Whenever you add or remove books, run `update-index.bat` and refresh the page (`F5`).

## Contributing a Language Pack

1. Copy `app/lang/en.json` to `app/lang/<code>.json` (for example, `app/lang/nl.json`).
2. Update `code`, `name`, `locale` (and `"dir": "rtl"` for right-to-left languages), and translate the values inside `strings`.
3. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\app\scripts\index-ebooks.ps1 -OnlyLang
   ```
4. Open `index.html` — your new language will automatically appear in the language selector.
