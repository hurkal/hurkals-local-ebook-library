(() => {
  "use strict";

  const PAGE_SIZE = 60;

  // Built-in English fallback strings (used if lang/ is empty or a pack omits a key)
  const FALLBACK_STRINGS = {
    pageTitle: "E-Book Library",
    appTitle: "E-Book Library",
    loadingDb: "Loading local book archive…",
    loadJson: "📂 Load JSON",
    loadJsonTitle: "Manually load a different books.json file",
    langSelectLabel: "Select language",
    themeToggleTitle: "Light / Dark Theme",
    themeToggleAria: "Toggle theme",
    themeLight: "☀️ Light",
    themeDark: "🌙 Dark",
    statsAria: "Library statistics",
    statTotal: "Total Books",
    statFiltered: "Showing",
    statSize: "Total Size",
    statFolders: "Folders",
    controlsAria: "Search and filtering",
    searchPlaceholder: "Search by title, author, filename, folder, or publisher… (Shortcut: /)",
    searchAria: "Search e-books",
    clearSearchAria: "Clear search",
    folderFilterAria: "Filter by folder",
    allFolders: "All Folders ({count})",
    rootFolder: "Root Folder",
    sortAria: "Sort by",
    sortTitleAsc: "Title (A → Z)",
    sortTitleDesc: "Title (Z → A)",
    sortAuthorAsc: "Author (A → Z)",
    sortModifiedDesc: "Recently Modified",
    sortAddedDesc: "Recently Added",
    sortSizeDesc: "Size (Largest First)",
    sortSizeAsc: "Size (Smallest First)",
    sortExtAsc: "Format (A → Z)",
    viewModeAria: "View mode",
    viewGridTitle: "Grid view",
    viewListTitle: "List view",
    formatFilterAria: "Format filter",
    formatAll: "All",
    resetFilters: "Reset Filters",
    resultsFilteredSummary: "{count} results found (out of {total} books)",
    resultsTotalSummary: "Showing {total} books",
    loadMore: "Show More ({remaining} books remaining)",
    emptyNoBooksTitle: "No indexed books yet",
    emptyNoBooksDesc: "Place this folder inside your e-books directory and run update-index.bat (or app/scripts/index-ebooks.ps1). Then refresh this page.",
    emptyNoMatchTitle: "No matching books found",
    emptyNoMatchDesc: "Try different keywords or clear the active format/folder filters.",
    loadDemoBtn: "Preview with Sample Library",
    clearSearchBtn: "Clear Search",
    dbMetaDemo: "Sample library preview mode (run update-index.bat for your own books)",
    dbMetaUpdated: "Last updated: {date}",
    dbMetaEmpty: "Database not generated yet",
    btnOpen: "Open",
    btnCopyPath: "Copy Path",
    btnCopyShort: "Copy",
    btnCopyFullTitle: "Copy full file path",
    btnDetails: "Details",
    dialogCloseAria: "Close",
    dialogUnknownAuthor: "Unknown author",
    metaFileName: "File Name",
    metaSize: "Size",
    metaFolder: "Folder",
    metaModified: "Modified",
    metaYear: "Year",
    metaPublisher: "Publisher",
    metaLanguage: "Language",
    metaSource: "Metadata Source",
    sourceEpub: "EPUB Metadata",
    sourceFilename: "File Name",
    dialogTags: "Tags",
    dialogDescription: "Description",
    dialogLocation: "File Location",
    dialogOpenFile: "Open File",
    dialogCopyFilePath: "Copy File Path",
    dialogCopyFolderPath: "Copy Folder Path",
    labelFilePath: "File path",
    labelFolderPath: "Folder path",
    toastCopied: "{label} copied",
    toastDemoNoOpen: "Cannot open files in sample mode",
    toastDemoLoaded: "Sample library loaded",
    toastFileLoaded: "{file} loaded",
    toastInvalidJson: "Invalid JSON file"
  };

  const i18n = {
    packs: {},
    currentCode: "en",
    currentLocale: "en-US",
    strings: { ...FALLBACK_STRINGS }
  };

  const state = {
    rawDb: null,
    allBooks: [],
    filteredBooks: [],
    visibleCount: PAGE_SIZE,
    search: "",
    selectedExt: "",
    selectedFolder: "",
    sortBy: "title-asc",
    viewMode: localStorage.getItem("ebook_view_mode") || "grid",
    activeBook: null,
    isDemo: false
  };

  // DOM element references
  const el = {
    langSelect: document.getElementById("langSelect"),
    dbMeta: document.getElementById("dbMeta"),
    statTotal: document.getElementById("statTotal"),
    statFiltered: document.getElementById("statFiltered"),
    statSize: document.getElementById("statSize"),
    statFolders: document.getElementById("statFolders"),
    searchInput: document.getElementById("searchInput"),
    clearSearchBtn: document.getElementById("clearSearchBtn"),
    folderFilter: document.getElementById("folderFilter"),
    sortSelect: document.getElementById("sortSelect"),
    viewGridBtn: document.getElementById("viewGridBtn"),
    viewListBtn: document.getElementById("viewListBtn"),
    formatPills: document.getElementById("formatPills"),
    resultsToolbar: document.getElementById("resultsToolbar"),
    resultsSummary: document.getElementById("resultsSummary"),
    resetFiltersBtn: document.getElementById("resetFiltersBtn"),
    resultsContainer: document.getElementById("resultsContainer"),
    loadMoreWrap: document.getElementById("loadMoreWrap"),
    loadMoreBtn: document.getElementById("loadMoreBtn"),
    emptyState: document.getElementById("emptyState"),
    emptyTitle: document.getElementById("emptyTitle"),
    emptyDesc: document.getElementById("emptyDesc"),
    loadDemoBtn: document.getElementById("loadDemoBtn"),
    emptyResetBtn: document.getElementById("emptyResetBtn"),
    jsonFileInput: document.getElementById("jsonFileInput"),
    themeToggle: document.getElementById("themeToggle"),
    bookDialog: document.getElementById("bookDialog"),
    closeDialogBtn: document.getElementById("closeDialogBtn"),
    dialogBadge: document.getElementById("dialogBadge"),
    dialogTitle: document.getElementById("dialogTitle"),
    dialogAuthor: document.getElementById("dialogAuthor"),
    dialogMeta: document.getElementById("dialogMeta"),
    dialogTagsWrap: document.getElementById("dialogTagsWrap"),
    dialogTags: document.getElementById("dialogTags"),
    dialogDescWrap: document.getElementById("dialogDescWrap"),
    dialogDesc: document.getElementById("dialogDesc"),
    dialogPath: document.getElementById("dialogPath"),
    dialogOpenLink: document.getElementById("dialogOpenLink"),
    copyFilePathBtn: document.getElementById("copyFilePathBtn"),
    copyFolderPathBtn: document.getElementById("copyFolderPathBtn"),
    toast: document.getElementById("toast")
  };

  function t(key, params) {
    let text =
      (i18n.strings && Object.prototype.hasOwnProperty.call(i18n.strings, key)
        ? i18n.strings[key]
        : FALLBACK_STRINGS[key]) || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return text;
  }

  function formatNumber(num) {
    return (Number(num) || 0).toLocaleString(i18n.currentLocale);
  }

  // Load language packs from lang/languages.js (file:// safe) and lang/*.json when served over HTTP
  async function loadLanguagePacks() {
    const packs = {};

    if (window.EBOOK_LANGS && typeof window.EBOOK_LANGS === "object") {
      for (const [code, pack] of Object.entries(window.EBOOK_LANGS)) {
        if (pack && typeof pack === "object") {
          const cleanCode = String(pack.code || code).toLowerCase();
          packs[cleanCode] = {
            code: cleanCode,
            name: String(pack.name || cleanCode.toUpperCase()),
            locale: String(pack.locale || cleanCode),
            dir: pack.dir === "rtl" ? "rtl" : "ltr",
            strings: { ...FALLBACK_STRINGS, ...(pack.strings || {}) }
          };
        }
      }
    }

    // When served over HTTP, also fetch live app/lang/manifest.json and app/lang/*.json files
    if (window.location.protocol !== "file:") {
      let filesToFetch = [];
      try {
        const res = await fetch("app/lang/manifest.json", { cache: "no-store" });
        if (res.ok) {
          const manifest = await res.json();
          if (Array.isArray(manifest)) {
            filesToFetch = manifest;
          } else if (manifest && Array.isArray(manifest.languages)) {
            filesToFetch = manifest.languages.map((item) =>
              typeof item === "string" ? item : item.file || `${item.code}.json`
            );
          }
        }
      } catch {
        // Fall back to default pack names if manifest.json is missing
      }

      if (filesToFetch.length === 0) {
        filesToFetch = ["en.json", "tr.json"];
      }

      await Promise.all(
        filesToFetch.map(async (fileName) => {
          try {
            const url = fileName.startsWith("app/lang/") ? fileName : `app/lang/${fileName}`;
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) return;
            const pack = await res.json();
            if (!pack || typeof pack !== "object") return;
            const cleanCode = String(
              pack.code || fileName.replace(/^.*\//, "").replace(/\.json$/i, "")
            ).toLowerCase();
            packs[cleanCode] = {
              code: cleanCode,
              name: String(pack.name || cleanCode.toUpperCase()),
              locale: String(pack.locale || cleanCode),
              dir: pack.dir === "rtl" ? "rtl" : "ltr",
              strings: { ...FALLBACK_STRINGS, ...(pack.strings || {}) }
            };
          } catch {
            // Ignore missing or unreadable language file
          }
        })
      );
    }

    i18n.packs = packs;
    renderLanguageSelector();

    const availableCodes = Object.keys(packs);
    if (availableCodes.length === 0) {
      i18n.currentCode = "en";
      i18n.currentLocale = "en-US";
      i18n.strings = { ...FALLBACK_STRINGS };
      applyStaticTranslations();
      return;
    }

    const saved = (localStorage.getItem("ebook_lang") || "").toLowerCase();
    const browserFull = (navigator.language || "").toLowerCase();
    const browserShort = browserFull.slice(0, 2);
    const initial =
      (saved && packs[saved] && saved) ||
      (browserFull && packs[browserFull] && browserFull) ||
      (browserShort && packs[browserShort] && browserShort) ||
      (packs.en && "en") ||
      availableCodes[0];

    setLanguage(initial, false);
  }

  function renderLanguageSelector() {
    const entries = Object.values(i18n.packs);
    el.langSelect.innerHTML = "";

    if (entries.length === 0) {
      el.langSelect.hidden = true;
      return;
    }

    // Keep English and Turkish at top, sort the rest alphabetically
    const priority = { en: 0, tr: 1 };
    entries.sort((a, b) => {
      const pa = Object.prototype.hasOwnProperty.call(priority, a.code) ? priority[a.code] : 99;
      const pb = Object.prototype.hasOwnProperty.call(priority, b.code) ? priority[b.code] : 99;
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });

    for (const pack of entries) {
      const opt = document.createElement("option");
      opt.value = pack.code;
      opt.textContent = pack.name;
      el.langSelect.appendChild(opt);
    }

    el.langSelect.hidden = false;
  }

  function applyStaticTranslations() {
    const pack = i18n.packs[i18n.currentCode];
    document.documentElement.lang = i18n.currentCode;
    document.documentElement.dir = pack && pack.dir === "rtl" ? "rtl" : "ltr";
    document.title = t("pageTitle");

    for (const node of document.querySelectorAll("[data-i18n]")) {
      node.textContent = t(node.dataset.i18n);
    }
    for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    }
    for (const node of document.querySelectorAll("[data-i18n-title]")) {
      node.title = t(node.dataset.i18nTitle);
    }
    for (const node of document.querySelectorAll("[data-i18n-aria-label]")) {
      node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
    }

    updateThemeButton();
  }

  function setLanguage(code, persist = true) {
    const cleanCode = String(code || "").toLowerCase();
    const pack = i18n.packs[cleanCode];
    if (!pack) return;

    i18n.currentCode = pack.code;
    i18n.currentLocale = pack.locale || pack.code;
    i18n.strings = pack.strings;

    if (persist) {
      localStorage.setItem("ebook_lang", pack.code);
    }

    el.langSelect.value = pack.code;
    applyStaticTranslations();

    // Refresh all dynamic UI sections immediately without reloading
    if (state.rawDb) {
      updateStatsAndMeta();
      const prevFolder = state.selectedFolder;
      buildFilterControls();
      state.selectedFolder = prevFolder;
      el.folderFilter.value = prevFolder;
      applyFiltersAndRender();
      if (el.bookDialog.open && state.activeBook) {
        renderDialogContent(state.activeBook);
      }
    }
  }

  // Diacritic-insensitive normalization (supports Turkish dotless-i and common accented letters)
  const CHAR_FOLD_MAP = {
    "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u",
    "â": "a", "î": "i", "û": "u", "é": "e", "è": "e", "ê": "e",
    "á": "a", "à": "a", "ä": "a", "ñ": "n", "ó": "o", "ò": "o",
    "ú": "u", "ù": "u", "ß": "ss"
  };

  function normalizeText(value) {
    if (!value) return "";
    const lower = String(value).toLocaleLowerCase("tr-TR");
    return lower.replace(/[çğıöşüâîûéèêáàäñóòúùß]/g, (ch) => CHAR_FOLD_MAP[ch] || ch);
  }

  function formatBytes(bytes) {
    const num = Number(bytes) || 0;
    if (num < 1024) return `${num} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let val = num / 1024;
    let idx = 0;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx++;
    }
    return `${val.toFixed(val >= 100 ? 0 : 1)} ${units[idx]}`;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(i18n.currentLocale, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(i18n.currentLocale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function getFolderDisplay(book) {
    if (book.rootName && book.subFolder) {
      return `${book.rootName} / ${book.subFolder.replace(/\\/g, " / ")}`;
    }
    return book.rootName || book.folderPath || t("rootFolder");
  }

  function getFolderKey(book) {
    return book.subFolder ? `${book.rootName}\\${book.subFolder}` : (book.rootName || book.folderPath || "");
  }

  // Safe match highlighting using DOM nodes (prevents HTML injection)
  function createHighlightedFragment(text, terms) {
    const frag = document.createDocumentFragment();
    const raw = String(text || "");
    if (!raw || !terms.length) {
      frag.appendChild(document.createTextNode(raw));
      return frag;
    }

    const folded = normalizeText(raw);
    const ranges = [];

    for (const term of terms) {
      if (!term) continue;
      let startIndex = 0;
      while (startIndex < folded.length) {
        const idx = folded.indexOf(term, startIndex);
        if (idx === -1) break;
        ranges.push([idx, idx + term.length]);
        startIndex = idx + term.length;
      }
    }

    if (!ranges.length) {
      frag.appendChild(document.createTextNode(raw));
      return frag;
    }

    // Merge overlapping highlight ranges
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = ranges[i];
      if (curr[0] <= prev[1]) {
        prev[1] = Math.max(prev[1], curr[1]);
      } else {
        merged.push(curr);
      }
    }

    let cursor = 0;
    for (const [start, end] of merged) {
      if (start > cursor) {
        frag.appendChild(document.createTextNode(raw.slice(cursor, start)));
      }
      const mark = document.createElement("mark");
      mark.textContent = raw.slice(start, end);
      frag.appendChild(mark);
      cursor = end;
    }
    if (cursor < raw.length) {
      frag.appendChild(document.createTextNode(raw.slice(cursor)));
    }
    return frag;
  }

  let toastTimer = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, 2400);
  }

  async function copyToClipboard(text, labelKey) {
    if (!text) return;
    const msg = t("toastCopied", { label: t(labelKey) });
    try {
      await navigator.clipboard.writeText(text);
      showToast(msg);
    } catch {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
      showToast(msg);
    }
  }

  // Pre-compute normalized search text and sort keys for fast filtering
  function prepareBooks(rawBooks) {
    return (Array.isArray(rawBooks) ? rawBooks : []).map((book) => {
      const folderDisplay = getFolderDisplay(book);
      const folderKey = getFolderKey(book);
      const tagsText = Array.isArray(book.tags) ? book.tags.join(" ") : "";
      const searchBlob = normalizeText([
        book.title,
        book.author,
        book.fileName,
        book.extension,
        folderDisplay,
        book.publisher,
        book.year,
        book.language,
        tagsText
      ].join(" "));

      return {
        ...book,
        _folderDisplay: folderDisplay,
        _folderKey: folderKey,
        _searchBlob: searchBlob,
        _titleSort: (book.title || book.fileName || "").toLocaleLowerCase(i18n.currentLocale),
        _authorSort: (book.author || "zzz").toLocaleLowerCase(i18n.currentLocale)
      };
    });
  }

  function updateStatsAndMeta() {
    const totalSize = state.allBooks.reduce((sum, b) => sum + (Number(b.sizeBytes) || 0), 0);
    const folderSet = new Set(state.allBooks.map((b) => b._folderKey).filter(Boolean));

    el.statTotal.textContent = formatNumber(state.allBooks.length);
    el.statSize.textContent = formatBytes(totalSize);
    el.statFolders.textContent = formatNumber(folderSet.size);

    if (state.isDemo) {
      el.dbMeta.textContent = t("dbMetaDemo");
    } else if (state.rawDb && state.rawDb.generatedAt) {
      el.dbMeta.textContent = t("dbMetaUpdated", { date: formatDateTime(state.rawDb.generatedAt) });
    } else {
      el.dbMeta.textContent = t("dbMetaEmpty");
    }
  }

  function loadDatabase(db, isDemo = false) {
    state.rawDb = db || { books: [] };
    state.isDemo = isDemo;
    state.allBooks = prepareBooks(state.rawDb.books);
    state.selectedExt = "";
    state.selectedFolder = "";
    state.search = "";
    el.searchInput.value = "";
    el.clearSearchBtn.hidden = true;

    updateStatsAndMeta();
    buildFilterControls();
    applyFiltersAndRender();
  }

  function buildFilterControls() {
    const extCounts = new Map();
    const folderCounts = new Map();

    for (const book of state.allBooks) {
      const ext = (book.extension || "other").toLowerCase();
      extCounts.set(ext, (extCounts.get(ext) || 0) + 1);

      const fKey = book._folderKey;
      if (fKey) {
        folderCounts.set(fKey, (folderCounts.get(fKey) || 0) + 1);
      }
    }

    el.formatPills.innerHTML = "";
    const allPill = createFormatPill("", t("formatAll"), state.allBooks.length);
    el.formatPills.appendChild(allPill);

    const sortedExts = [...extCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [ext, count] of sortedExts) {
      el.formatPills.appendChild(createFormatPill(ext, ext.toUpperCase(), count));
    }

    el.folderFilter.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = t("allFolders", { count: formatNumber(folderCounts.size) });
    el.folderFilter.appendChild(defaultOpt);

    const sortedFolders = [...folderCounts.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], i18n.currentLocale)
    );
    for (const [folderKey, count] of sortedFolders) {
      const opt = document.createElement("option");
      opt.value = folderKey;
      opt.textContent = `${folderKey.replace(/\\/g, " / ")} (${formatNumber(count)})`;
      el.folderFilter.appendChild(opt);
    }
  }

  function createFormatPill(extValue, label, count) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill" + (state.selectedExt === extValue ? " active" : "");
    btn.dataset.ext = extValue;
    btn.textContent = label;

    const countSpan = document.createElement("span");
    countSpan.className = "pill-count";
    countSpan.textContent = `(${formatNumber(count)})`;
    btn.appendChild(countSpan);

    btn.addEventListener("click", () => {
      state.selectedExt = extValue;
      for (const node of el.formatPills.querySelectorAll(".pill")) {
        node.classList.toggle("active", node.dataset.ext === extValue);
      }
      applyFiltersAndRender();
    });

    return btn;
  }

  function applyFiltersAndRender() {
    const queryTerms = normalizeText(state.search).split(/\s+/).filter(Boolean);

    const filtered = state.allBooks.filter((book) => {
      if (state.selectedExt && (book.extension || "").toLowerCase() !== state.selectedExt) {
        return false;
      }
      if (state.selectedFolder && book._folderKey !== state.selectedFolder) {
        return false;
      }
      for (const term of queryTerms) {
        if (!book._searchBlob.includes(term)) {
          return false;
        }
      }
      return true;
    });

    sortBooks(filtered, state.sortBy);
    state.filteredBooks = filtered;
    state.visibleCount = PAGE_SIZE;

    el.statFiltered.textContent = formatNumber(filtered.length);

    const hasActiveFilters = Boolean(state.search || state.selectedExt || state.selectedFolder);
    el.resultsToolbar.hidden = !hasActiveFilters && state.allBooks.length === 0;
    if (!el.resultsToolbar.hidden) {
      el.resultsSummary.textContent = hasActiveFilters
        ? t("resultsFilteredSummary", {
            count: formatNumber(filtered.length),
            total: formatNumber(state.allBooks.length)
          })
        : t("resultsTotalSummary", { total: formatNumber(state.allBooks.length) });
      el.resetFiltersBtn.hidden = !hasActiveFilters;
    }

    renderBooks(queryTerms);
  }

  function sortBooks(list, mode) {
    const cmp = (a, b) => a.localeCompare(b, i18n.currentLocale);
    list.sort((a, b) => {
      switch (mode) {
        case "title-desc":
          return cmp(b._titleSort, a._titleSort);
        case "author-asc":
          return cmp(a._authorSort, b._authorSort) || cmp(a._titleSort, b._titleSort);
        case "modified-desc":
          return String(b.lastModified || "").localeCompare(String(a.lastModified || ""));
        case "added-desc":
          return String(b.addedAt || "").localeCompare(String(a.addedAt || ""));
        case "size-desc":
          return (Number(b.sizeBytes) || 0) - (Number(a.sizeBytes) || 0);
        case "size-asc":
          return (Number(a.sizeBytes) || 0) - (Number(b.sizeBytes) || 0);
        case "ext-asc":
          return cmp(a.extension || "", b.extension || "") || cmp(a._titleSort, b._titleSort);
        case "title-asc":
        default:
          return cmp(a._titleSort, b._titleSort);
      }
    });
  }

  function renderBooks(queryTerms = normalizeText(state.search).split(/\s+/).filter(Boolean)) {
    el.resultsContainer.innerHTML = "";
    el.resultsContainer.className = state.viewMode === "list" ? "results-list" : "results-grid";

    if (state.allBooks.length === 0) {
      el.emptyState.hidden = false;
      el.emptyTitle.textContent = t("emptyNoBooksTitle");
      el.emptyDesc.textContent = t("emptyNoBooksDesc");
      el.loadDemoBtn.hidden = false;
      el.emptyResetBtn.hidden = true;
      el.loadMoreWrap.hidden = true;
      return;
    }

    if (state.filteredBooks.length === 0) {
      el.emptyState.hidden = false;
      el.emptyTitle.textContent = t("emptyNoMatchTitle");
      el.emptyDesc.textContent = t("emptyNoMatchDesc");
      el.loadDemoBtn.hidden = true;
      el.emptyResetBtn.hidden = false;
      el.loadMoreWrap.hidden = true;
      return;
    }

    el.emptyState.hidden = true;

    const slice = state.filteredBooks.slice(0, state.visibleCount);
    const frag = document.createDocumentFragment();

    for (const book of slice) {
      frag.appendChild(
        state.viewMode === "list"
          ? createBookRow(book, queryTerms)
          : createBookCard(book, queryTerms)
      );
    }

    el.resultsContainer.appendChild(frag);

    const remaining = state.filteredBooks.length - slice.length;
    el.loadMoreWrap.hidden = remaining <= 0;
    if (remaining > 0) {
      el.loadMoreBtn.textContent = t("loadMore", { remaining: formatNumber(remaining) });
    }
  }

  function createBadge(ext) {
    const cleanExt = (ext || "file").toLowerCase();
    const span = document.createElement("span");
    span.className = `badge badge-${cleanExt}`;
    span.textContent = cleanExt.toUpperCase();
    return span;
  }

  function createBookCard(book, queryTerms) {
    const card = document.createElement("article");
    card.className = "book-card";
    card.tabIndex = 0;

    const top = document.createElement("div");
    top.className = "book-card-top";
    top.appendChild(createBadge(book.extension));

    const sizeEl = document.createElement("span");
    sizeEl.className = "book-size";
    sizeEl.textContent = formatBytes(book.sizeBytes);
    top.appendChild(sizeEl);

    const titleEl = document.createElement("h2");
    titleEl.className = "book-title";
    titleEl.appendChild(createHighlightedFragment(book.title || book.fileName, queryTerms));

    const authorEl = document.createElement("p");
    authorEl.className = "book-author";
    if (book.author) {
      authorEl.appendChild(createHighlightedFragment(book.author, queryTerms));
    } else {
      authorEl.textContent = book.fileName;
    }

    const folderRow = document.createElement("div");
    folderRow.className = "book-folder";
    const folderSpan = document.createElement("span");
    folderSpan.className = "folder-text";
    folderSpan.title = book.folderPath || book._folderDisplay;
    folderSpan.textContent = `📁 ${book._folderDisplay}`;
    folderRow.appendChild(folderSpan);

    if (book.year) {
      const yearSpan = document.createElement("span");
      yearSpan.textContent = book.year;
      folderRow.appendChild(yearSpan);
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const openLink = document.createElement("a");
    openLink.className = "mini-btn";
    openLink.href = book.fileUri || "#";
    openLink.target = "_blank";
    openLink.rel = "noopener";
    openLink.textContent = t("btnOpen");
    openLink.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!book.fileUri || state.isDemo) {
        e.preventDefault();
        showToast(t("toastDemoNoOpen"));
      }
    });

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "mini-btn";
    copyBtn.textContent = t("btnCopyPath");
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyToClipboard(book.fullPath, "labelFilePath");
    });

    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.className = "mini-btn";
    detailBtn.textContent = t("btnDetails");
    detailBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openBookDialog(book);
    });

    actions.append(openLink, copyBtn, detailBtn);
    card.append(top, titleEl, authorEl, folderRow, actions);

    card.addEventListener("click", () => openBookDialog(book));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openBookDialog(book);
      }
    });

    return card;
  }

  function createBookRow(book, queryTerms) {
    const row = document.createElement("article");
    row.className = "book-row";
    row.tabIndex = 0;

    const badgeWrap = document.createElement("div");
    badgeWrap.appendChild(createBadge(book.extension));

    const titleEl = document.createElement("div");
    titleEl.className = "row-title";
    titleEl.title = book.title || book.fileName;
    titleEl.appendChild(createHighlightedFragment(book.title || book.fileName, queryTerms));

    const authorEl = document.createElement("div");
    authorEl.className = "row-muted row-author";
    authorEl.title = book.author || "";
    authorEl.appendChild(createHighlightedFragment(book.author || "—", queryTerms));

    const folderEl = document.createElement("div");
    folderEl.className = "row-muted row-folder";
    folderEl.title = book._folderDisplay;
    folderEl.textContent = book._folderDisplay;

    const sizeEl = document.createElement("div");
    sizeEl.className = "row-muted row-size";
    sizeEl.textContent = formatBytes(book.sizeBytes);

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "mini-btn";
    copyBtn.textContent = t("btnCopyShort");
    copyBtn.title = t("btnCopyFullTitle");
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyToClipboard(book.fullPath, "labelFilePath");
    });

    actions.appendChild(copyBtn);
    row.append(badgeWrap, titleEl, authorEl, folderEl, sizeEl, actions);

    row.addEventListener("click", () => openBookDialog(book));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openBookDialog(book);
      }
    });

    return row;
  }

  function renderDialogContent(book) {
    const cleanExt = (book.extension || "file").toLowerCase();
    el.dialogBadge.className = `badge badge-${cleanExt}`;
    el.dialogBadge.textContent = cleanExt.toUpperCase();
    el.dialogTitle.textContent = book.title || book.fileName;
    el.dialogAuthor.textContent = book.author || t("dialogUnknownAuthor");

    const metaPairs = [
      [t("metaFileName"), book.fileName],
      [t("metaSize"), formatBytes(book.sizeBytes)],
      [t("metaFolder"), book._folderDisplay],
      [t("metaModified"), formatDate(book.lastModified)],
      [t("metaYear"), book.year || "—"],
      [t("metaPublisher"), book.publisher || "—"],
      [t("metaLanguage"), book.language ? book.language.toUpperCase() : "—"],
      [t("metaSource"), book.metadataSource === "epub" ? t("sourceEpub") : t("sourceFilename")]
    ];

    el.dialogMeta.innerHTML = "";
    for (const [label, value] of metaPairs) {
      const wrap = document.createElement("div");
      wrap.className = "meta-item";
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      wrap.append(dt, dd);
      el.dialogMeta.appendChild(wrap);
    }

    if (Array.isArray(book.tags) && book.tags.length > 0) {
      el.dialogTagsWrap.hidden = false;
      el.dialogTags.innerHTML = "";
      for (const tag of book.tags) {
        const span = document.createElement("span");
        span.className = "tag";
        span.textContent = tag;
        el.dialogTags.appendChild(span);
      }
    } else {
      el.dialogTagsWrap.hidden = true;
    }

    if (book.description) {
      el.dialogDescWrap.hidden = false;
      el.dialogDesc.textContent = book.description;
    } else {
      el.dialogDescWrap.hidden = true;
    }

    el.dialogPath.textContent = book.fullPath || "";
    el.dialogOpenLink.href = book.fileUri || "#";
  }

  function openBookDialog(book) {
    state.activeBook = book;
    renderDialogContent(book);
    el.bookDialog.showModal();
  }

  function setViewMode(mode) {
    state.viewMode = mode === "list" ? "list" : "grid";
    localStorage.setItem("ebook_view_mode", state.viewMode);
    el.viewGridBtn.classList.toggle("active", state.viewMode === "grid");
    el.viewGridBtn.setAttribute("aria-pressed", String(state.viewMode === "grid"));
    el.viewListBtn.classList.toggle("active", state.viewMode === "list");
    el.viewListBtn.setAttribute("aria-pressed", String(state.viewMode === "list"));
    renderBooks();
  }

  function resetFilters() {
    state.search = "";
    state.selectedExt = "";
    state.selectedFolder = "";
    el.searchInput.value = "";
    el.clearSearchBtn.hidden = true;
    el.folderFilter.value = "";
    for (const node of el.formatPills.querySelectorAll(".pill")) {
      node.classList.toggle("active", node.dataset.ext === "");
    }
    applyFiltersAndRender();
  }

  // Theme management
  function initTheme() {
    const saved = localStorage.getItem("ebook_theme");
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-theme", saved);
    }
    updateThemeButton();
  }

  function updateThemeButton() {
    const current = document.documentElement.getAttribute("data-theme");
    const isDark =
      current === "dark" ||
      (!current && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    el.themeToggle.textContent = isDark ? t("themeLight") : t("themeDark");
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    const isDark =
      current === "dark" ||
      (!current && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("ebook_theme", next);
    updateThemeButton();
  }

  // Sample dataset so first-time users can preview the UI before scanning their own folders
  function getDemoDatabase() {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      books: [
        {
          id: "demo01",
          title: "Foundation",
          author: "Isaac Asimov",
          fileName: "Isaac Asimov - Foundation (1951).epub",
          extension: "epub",
          sizeBytes: 1210400,
          lastModified: "2025-09-02T19:15:00",
          addedAt: "2026-02-01T11:30:00",
          rootName: "E-Books",
          subFolder: "Sci-Fi\\Asimov",
          folderPath: "D:\\E-Books\\Sci-Fi\\Asimov",
          fullPath: "D:\\E-Books\\Sci-Fi\\Asimov\\Isaac Asimov - Foundation (1951).epub",
          fileUri: "",
          year: "1951",
          publisher: "Gnome Press",
          language: "en",
          tags: ["Sci-Fi", "Classic"],
          description: "Hari Seldon develops psychohistory to preserve knowledge across a falling Galactic Empire.",
          metadataSource: "epub"
        },
        {
          id: "demo02",
          title: "Clean Code: A Handbook of Agile Software Craftsmanship",
          author: "Robert C. Martin",
          fileName: "Robert C. Martin - Clean Code (2008).pdf",
          extension: "pdf",
          sizeBytes: 9437184,
          lastModified: "2026-03-14T10:05:00",
          addedAt: "2026-03-14T10:05:00",
          rootName: "E-Books",
          subFolder: "Software\\Architecture",
          folderPath: "D:\\E-Books\\Software\\Architecture",
          fullPath: "D:\\E-Books\\Software\\Architecture\\Robert C. Martin - Clean Code (2008).pdf",
          fileUri: "",
          year: "2008",
          publisher: "Prentice Hall",
          language: "en",
          tags: ["Software", "Programming"],
          description: "",
          metadataSource: "filename"
        },
        {
          id: "demo03",
          title: "Dune",
          author: "Frank Herbert",
          fileName: "Frank Herbert - Dune.mobi",
          extension: "mobi",
          sizeBytes: 3145728,
          lastModified: "2024-12-22T21:00:00",
          addedAt: "2025-05-04T16:40:00",
          rootName: "E-Books",
          subFolder: "Sci-Fi",
          folderPath: "D:\\E-Books\\Sci-Fi",
          fullPath: "D:\\E-Books\\Sci-Fi\\Frank Herbert - Dune.mobi",
          fileUri: "",
          year: "1965",
          publisher: "Chilton Books",
          language: "en",
          tags: ["Sci-Fi"],
          description: "",
          metadataSource: "filename"
        },
        {
          id: "demo04",
          title: "Sapiens: A Brief History of Humankind",
          author: "Yuval Noah Harari",
          fileName: "Yuval Noah Harari - Sapiens.pdf",
          extension: "pdf",
          sizeBytes: 14680064,
          lastModified: "2025-07-18T12:10:00",
          addedAt: "2025-07-18T12:10:00",
          rootName: "Books",
          subFolder: "History",
          folderPath: "C:\\Books\\History",
          fullPath: "C:\\Books\\History\\Yuval Noah Harari - Sapiens.pdf",
          fileUri: "",
          year: "2011",
          publisher: "Harper",
          language: "en",
          tags: ["History", "Anthropology"],
          description: "",
          metadataSource: "filename"
        },
        {
          id: "demo05",
          title: "Tutunamayanlar",
          author: "Oğuz Atay",
          fileName: "Oğuz Atay - Tutunamayanlar.epub",
          extension: "epub",
          sizeBytes: 1843200,
          lastModified: "2025-11-10T14:20:00",
          addedAt: "2026-01-12T09:00:00",
          rootName: "Books",
          subFolder: "Literature",
          folderPath: "C:\\Books\\Literature",
          fullPath: "C:\\Books\\Literature\\Oğuz Atay - Tutunamayanlar.epub",
          fileUri: "",
          year: "1972",
          publisher: "İletişim Yayınları",
          language: "tr",
          tags: ["Novel", "Modern Classic"],
          description: "A landmark modernist novel of Turkish literature.",
          metadataSource: "epub"
        }
      ]
    };
  }

  function bindEvents() {
    el.langSelect.addEventListener("change", () => {
      setLanguage(el.langSelect.value, true);
    });

    let searchTimer = null;
    el.searchInput.addEventListener("input", () => {
      const val = el.searchInput.value;
      el.clearSearchBtn.hidden = !val;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = val;
        applyFiltersAndRender();
      }, 100);
    });

    el.clearSearchBtn.addEventListener("click", () => {
      el.searchInput.value = "";
      el.clearSearchBtn.hidden = true;
      state.search = "";
      applyFiltersAndRender();
      el.searchInput.focus();
    });

    el.folderFilter.addEventListener("change", () => {
      state.selectedFolder = el.folderFilter.value;
      applyFiltersAndRender();
    });

    el.sortSelect.addEventListener("change", () => {
      state.sortBy = el.sortSelect.value;
      applyFiltersAndRender();
    });

    el.viewGridBtn.addEventListener("click", () => setViewMode("grid"));
    el.viewListBtn.addEventListener("click", () => setViewMode("list"));
    el.resetFiltersBtn.addEventListener("click", resetFilters);
    el.emptyResetBtn.addEventListener("click", resetFilters);

    el.loadMoreBtn.addEventListener("click", () => {
      state.visibleCount += PAGE_SIZE;
      renderBooks();
    });

    el.loadDemoBtn.addEventListener("click", () => {
      loadDatabase(getDemoDatabase(), true);
      showToast(t("toastDemoLoaded"));
    });

    el.themeToggle.addEventListener("click", toggleTheme);

    el.jsonFileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          loadDatabase(parsed, false);
          showToast(t("toastFileLoaded", { file: file.name }));
        } catch {
          showToast(t("toastInvalidJson"));
        }
      };
      reader.readAsText(file, "UTF-8");
      el.jsonFileInput.value = "";
    });

    // Dialog light-dismiss on backdrop click
    el.closeDialogBtn.addEventListener("click", () => el.bookDialog.close());
    el.bookDialog.addEventListener("click", (e) => {
      if (e.target === el.bookDialog) {
        el.bookDialog.close();
      }
    });

    el.dialogOpenLink.addEventListener("click", (e) => {
      if (!state.activeBook || !state.activeBook.fileUri || state.isDemo) {
        e.preventDefault();
        showToast(t("toastDemoNoOpen"));
      }
    });

    el.copyFilePathBtn.addEventListener("click", () => {
      if (state.activeBook) {
        copyToClipboard(state.activeBook.fullPath, "labelFilePath");
      }
    });

    el.copyFolderPathBtn.addEventListener("click", () => {
      if (state.activeBook) {
        copyToClipboard(state.activeBook.folderPath, "labelFolderPath");
      }
    });

    // Keyboard shortcuts: "/" or Ctrl/Cmd+K focuses the search box
    document.addEventListener("keydown", (e) => {
      if ((e.key === "/" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) &&
          document.activeElement !== el.searchInput &&
          !el.bookDialog.open) {
        e.preventDefault();
        el.searchInput.focus();
        el.searchInput.select();
      }
    });
  }

  async function init() {
    initTheme();
    bindEvents();
    await loadLanguagePacks();
    setViewMode(state.viewMode);

    if (window.EBOOK_DB && Array.isArray(window.EBOOK_DB.books)) {
      loadDatabase(window.EBOOK_DB, false);
      return;
    }

    if (window.location.protocol !== "file:") {
      try {
        const res = await fetch("app/data/books.json", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          loadDatabase(data, false);
          return;
        }
      } catch {
        // Fall through to empty state
      }
    }

    loadDatabase({ books: [] }, false);
  }

  init();
})();
