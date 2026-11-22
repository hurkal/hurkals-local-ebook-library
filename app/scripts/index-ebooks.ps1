<#
.SYNOPSIS
    Scans e-book folders and generates/updates a local JSON (and optional XML) library database.

.DESCRIPTION
    Recursively scans the folders configured in config.json and builds a searchable
    local e-book database. Uses incremental indexing: unchanged files keep their cached
    metadata (including EPUB metadata), only new or modified files are parsed, and
    deleted files are removed.

    Also generates data/books.js and lang/languages.js bridges so index.html works
    directly over the file:// protocol without browser CORS errors or a local server.

.PARAMETER ConfigPath
    Path to the configuration JSON file. Defaults to app/config/config.json.

.PARAMETER Folders
    Overrides the folder list from app/config/config.json via CLI arguments.

.PARAMETER Force
    Ignores the existing cache and re-scans metadata for all files from scratch.

.PARAMETER Fast
    Skips EPUB internal metadata extraction and parses filenames only.

.PARAMETER ExportXml
    Also exports the database to data/books.xml alongside data/books.json.

.PARAMETER OnlyLang
    Only regenerates lang/manifest.json and lang/languages.js without scanning books.

.EXAMPLE
    .\index-ebooks.ps1
.EXAMPLE
    .\index-ebooks.ps1 -Folders "C:\Books","D:\Archive\PDF" -ExportXml
.EXAMPLE
    .\index-ebooks.ps1 -Force
.EXAMPLE
    .\index-ebooks.ps1 -OnlyLang
#>

[CmdletBinding()]
param(
    [string]$ConfigPath = "",
    [string[]]$Folders,
    [switch]$Force,
    [switch]$Fast,
    [switch]$ExportXml,
    [switch]$OnlyLang
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$AppDir = Split-Path -Parent $ScriptDir
$ProjectRoot = Split-Path -Parent $AppDir
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path (Join-Path $AppDir "config") "config.json"
}

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
}
catch {
    # Ignore if console output is redirected
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
try { Add-Type -AssemblyName System.Net -ErrorAction SilentlyContinue } catch {}
$hasWebSerializer = $false
try {
    Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
    $hasWebSerializer = $true
}
catch {}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-JsonFast {
    param([string]$JsonText)
    # Use JavaScriptSerializer on Windows PowerShell 5.1 to avoid ConvertFrom-Json's 2 MB limit
    if ($hasWebSerializer) {
        $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $ser.MaxJsonLength = [int]::MaxValue
        return $ser.DeserializeObject($JsonText)
    }
    return ($JsonText | ConvertFrom-Json)
}

function ConvertTo-JsonFast {
    param([object]$Data)
    return ($Data | ConvertTo-Json -Depth 6 -Compress)
}

function Get-Prop {
    param([object]$Obj, [string]$Name, $Default = "")
    if ($null -eq $Obj) { return $Default }
    if ($Obj -is [System.Collections.IDictionary]) {
        $hasKey = $false
        if ($Obj.PSObject.Methods["ContainsKey"]) {
            $hasKey = $Obj.ContainsKey($Name)
        }
        else {
            $hasKey = $Obj.Contains($Name)
        }
        if ($hasKey) {
            $v = $Obj[$Name]
            if ($null -ne $v) { return $v }
        }
        return $Default
    }
    if ($Obj.PSObject.Properties[$Name]) {
        $v = $Obj.$Name
        if ($null -ne $v) { return $v }
    }
    return $Default
}

function Read-Utf8Text {
    param([string]$Path)
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8Text {
    param([string]$Path, [string]$Content)
    $parent = Split-Path -Path $Path -Parent
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        [void](New-Item -ItemType Directory -Path $parent -Force)
    }
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Get-StableId {
    param([string]$Text)
    $sha1 = [System.Security.Cryptography.SHA1]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text.ToLowerInvariant())
        $hash = $sha1.ComputeHash($bytes)
        $hex = ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
        return $hex.Substring(0, 12)
    }
    finally {
        $sha1.Dispose()
    }
}

function Clean-Whitespace {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
    return (($Text -replace '\s+', ' ').Trim())
}

function Parse-FileNameMetadata {
    param([string]$BaseName)

    $clean = Clean-Whitespace ($BaseName -replace '_', ' ')
    $year = ""

    $yearMatch = [regex]::Match($clean, '[\(\[\s]((?:18|19|20)\d{2})[\)\]\s]?$')
    if (-not $yearMatch.Success) {
        $yearMatch = [regex]::Match($clean, '[\(\[]((?:18|19|20)\d{2})[\)\]]')
    }
    if ($yearMatch.Success) {
        $year = $yearMatch.Groups[1].Value
    }

    $title = $clean
    $author = ""

    # Split "Author Name - Book Title" pattern
    if ($clean -match '^\s*(.+?)\s+-\s+(.+)\s*$') {
        $left = Clean-Whitespace $Matches[1]
        $right = Clean-Whitespace $Matches[2]
        # Treat the left part as author unless it is purely numeric (e.g., series index)
        if ($left -and ($left -notmatch '^\d+$') -and $right) {
            $author = $left
            $title = $right
        }
    }

    return [ordered]@{
        title  = $title
        author = $author
        year   = $year
    }
}

function Get-EpubMetadata {
    param([string]$FilePath)

    $result = $null
    $zip = $null
    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($FilePath)

        $findEntry = {
            param($archive, [string]$targetPath)
            $normTarget = ($targetPath -replace '\\', '/').TrimStart('/')
            $found = $archive.GetEntry($normTarget)
            if ($found) { return $found }
            foreach ($e in $archive.Entries) {
                $normEntry = ($e.FullName -replace '\\', '/').TrimStart('/')
                if ($normEntry -ieq $normTarget) {
                    return $e
                }
            }
            return $null
        }

        $containerEntry = & $findEntry $zip "META-INF/container.xml"
        if (-not $containerEntry) { return $null }

        $reader = New-Object System.IO.StreamReader($containerEntry.Open(), [System.Text.Encoding]::UTF8)
        try {
            $containerXmlText = $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }

        [xml]$containerXml = $containerXmlText
        $rootFileNode = $containerXml.SelectSingleNode("//*[local-name()='rootfile']")
        if (-not $rootFileNode) { return $null }

        $opfPath = $rootFileNode.GetAttribute("full-path")
        if ([string]::IsNullOrWhiteSpace($opfPath)) { return $null }
        $opfPathNormalized = [System.Uri]::UnescapeDataString($opfPath).TrimStart('/')

        $opfEntry = & $findEntry $zip $opfPathNormalized
        if (-not $opfEntry) { return $null }

        $opfReader = New-Object System.IO.StreamReader($opfEntry.Open(), [System.Text.Encoding]::UTF8)
        try {
            $opfXmlText = $opfReader.ReadToEnd()
        }
        finally {
            $opfReader.Dispose()
        }

        [xml]$opfXml = $opfXmlText

        $titleNode = $opfXml.SelectSingleNode("//*[local-name()='metadata']/*[local-name()='title']")
        $creatorNodes = $opfXml.SelectNodes("//*[local-name()='metadata']/*[local-name()='creator']")
        $publisherNode = $opfXml.SelectSingleNode("//*[local-name()='metadata']/*[local-name()='publisher']")
        $languageNode = $opfXml.SelectSingleNode("//*[local-name()='metadata']/*[local-name()='language']")
        $dateNode = $opfXml.SelectSingleNode("//*[local-name()='metadata']/*[local-name()='date']")
        $descNode = $opfXml.SelectSingleNode("//*[local-name()='metadata']/*[local-name()='description']")
        $subjectNodes = $opfXml.SelectNodes("//*[local-name()='metadata']/*[local-name()='subject']")

        $authors = New-Object System.Collections.Generic.List[string]
        if ($creatorNodes) {
            foreach ($node in $creatorNodes) {
                $val = Clean-Whitespace $node.InnerText
                if ($val -and -not $authors.Contains($val)) {
                    $authors.Add($val)
                }
            }
        }

        $tags = New-Object System.Collections.Generic.List[string]
        if ($subjectNodes) {
            foreach ($node in $subjectNodes) {
                $val = Clean-Whitespace $node.InnerText
                if ($val -and $val.Length -le 60 -and -not $tags.Contains($val)) {
                    $tags.Add($val)
                }
                if ($tags.Count -ge 8) { break }
            }
        }

        $year = ""
        if ($dateNode -and $dateNode.InnerText) {
            $m = [regex]::Match($dateNode.InnerText, '((?:18|19|20)\d{2})')
            if ($m.Success) { $year = $m.Groups[1].Value }
        }

        $description = ""
        if ($descNode -and $descNode.InnerText) {
            $plain = [System.Net.WebUtility]::HtmlDecode(($descNode.InnerText -replace '<[^>]+>', ' '))
            $plain = Clean-Whitespace $plain
            if ($plain.Length -gt 450) {
                $plain = $plain.Substring(0, 447).TrimEnd() + "..."
            }
            $description = $plain
        }

        $titleText = if ($titleNode) { Clean-Whitespace $titleNode.InnerText } else { "" }
        $pubText = if ($publisherNode) { Clean-Whitespace $publisherNode.InnerText } else { "" }
        $langText = if ($languageNode) { (Clean-Whitespace $languageNode.InnerText).ToLowerInvariant() } else { "" }

        $result = [ordered]@{
            title       = $titleText
            author      = ($authors -join ", ")
            publisher   = $pubText
            language    = $langText
            year        = $year
            tags        = @($tags)
            description = $description
        }
    }
    catch {
        # Skip corrupted or DRM-protected EPUB files without aborting the scan
        $result = $null
    }
    finally {
        if ($zip) { $zip.Dispose() }
    }

    return $result
}

function Get-FilesSafe {
    param(
        [string]$RootPath,
        [System.Collections.Generic.HashSet[string]]$ExtSet,
        [System.Collections.Generic.HashSet[string]]$ExcludeSet,
        [string[]]$SkipDirs = @()
    )

    $skipSet = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($sd in $SkipDirs) {
        if (-not [string]::IsNullOrWhiteSpace($sd)) {
            [void]$skipSet.Add($sd.TrimEnd('\').ToLowerInvariant())
        }
    }

    $results = New-Object System.Collections.Generic.List[System.IO.FileInfo]
    $stack = New-Object System.Collections.Generic.Stack[string]
    $stack.Push($RootPath)

    while ($stack.Count -gt 0) {
        $currentDir = $stack.Pop()
        if ($skipSet.Contains($currentDir.TrimEnd('\').ToLowerInvariant())) {
            continue
        }

        try {
            $dirInfo = New-Object System.IO.DirectoryInfo($currentDir)
            foreach ($file in $dirInfo.GetFiles()) {
                if ($ExtSet.Contains($file.Extension.ToLowerInvariant())) {
                    $results.Add($file)
                }
            }
        }
        catch {
            Write-Warning "Could not read files (access error): $currentDir"
        }

        try {
            $dirInfo = New-Object System.IO.DirectoryInfo($currentDir)
            foreach ($subDir in $dirInfo.GetDirectories()) {
                if ($skipSet.Contains($subDir.FullName.TrimEnd('\').ToLowerInvariant())) {
                    continue
                }
                if ($ExcludeSet.Contains($subDir.Name.ToLowerInvariant())) {
                    continue
                }
                # Skip reparse points / symlinks to prevent infinite loops
                if (($subDir.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    continue
                }
                $stack.Push($subDir.FullName)
            }
        }
        catch {
            Write-Warning "Could not read subdirectories (access error): $currentDir"
        }
    }

    return , $results
}

function Export-BooksToXml {
    param(
        [object]$DbObject,
        [string]$XmlPath
    )

    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Indent = $true
    $settings.Encoding = $utf8NoBom

    $parent = Split-Path -Path $XmlPath -Parent
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        [void](New-Item -ItemType Directory -Path $parent -Force)
    }

    $writer = [System.Xml.XmlWriter]::Create($XmlPath, $settings)
    try {
        $writer.WriteStartDocument()
        $writer.WriteStartElement("library")
        $writer.WriteAttributeString("schemaVersion", [string]$DbObject.schemaVersion)
        $writer.WriteAttributeString("generatedAt", [string]$DbObject.generatedAt)
        $writer.WriteAttributeString("totalBooks", [string]$DbObject.stats.totalBooks)

        $writer.WriteStartElement("books")
        foreach ($book in $DbObject.books) {
            $writer.WriteStartElement("book")
            $writer.WriteAttributeString("id", [string]$book.id)
            $writer.WriteElementString("title", [string]$book.title)
            $writer.WriteElementString("author", [string]$book.author)
            $writer.WriteElementString("fileName", [string]$book.fileName)
            $writer.WriteElementString("extension", [string]$book.extension)
            $writer.WriteElementString("sizeBytes", [string]$book.sizeBytes)
            $writer.WriteElementString("lastModified", [string]$book.lastModified)
            $writer.WriteElementString("addedAt", [string]$book.addedAt)
            $writer.WriteElementString("rootName", [string]$book.rootName)
            $writer.WriteElementString("subFolder", [string]$book.subFolder)
            $writer.WriteElementString("folderPath", [string]$book.folderPath)
            $writer.WriteElementString("fullPath", [string]$book.fullPath)
            $writer.WriteElementString("fileUri", [string]$book.fileUri)
            $writer.WriteElementString("year", [string]$book.year)
            $writer.WriteElementString("publisher", [string]$book.publisher)
            $writer.WriteElementString("language", [string]$book.language)
            $writer.WriteElementString("description", [string]$book.description)
            $writer.WriteElementString("metadataSource", [string]$book.metadataSource)

            $writer.WriteStartElement("tags")
            if ($book.tags) {
                foreach ($tag in $book.tags) {
                    $writer.WriteElementString("tag", [string]$tag)
                }
            }
            $writer.WriteEndElement() # tags
            $writer.WriteEndElement() # book
        }
        $writer.WriteEndElement() # books
        $writer.WriteEndElement() # library
        $writer.WriteEndDocument()
    }
    finally {
        $writer.Dispose()
    }
}

function Sync-LanguagePacks {
    param([string]$BaseDir)

    $langDir = Join-Path $BaseDir "lang"
    if (-not (Test-Path -LiteralPath $langDir -PathType Container)) {
        return
    }

    $langFiles = @(Get-ChildItem -LiteralPath $langDir -Filter "*.json" -File | Where-Object { $_.Name -ine "manifest.json" } | Sort-Object Name)
    $packs = [ordered]@{}
    $manifestList = New-Object System.Collections.Generic.List[object]

    foreach ($lf in $langFiles) {
        try {
            $parsed = (Read-Utf8Text -Path $lf.FullName) | ConvertFrom-Json
            $code = [string](Get-Prop -Obj $parsed -Name "code" -Default ([System.IO.Path]::GetFileNameWithoutExtension($lf.Name)))
            $code = $code.Trim().ToLowerInvariant()
            if (-not $code) { continue }

            $name = [string](Get-Prop -Obj $parsed -Name "name" -Default $code.ToUpperInvariant())
            $locale = [string](Get-Prop -Obj $parsed -Name "locale" -Default $code)
            $dir = [string](Get-Prop -Obj $parsed -Name "dir" -Default "ltr")
            $stringsObj = Get-Prop -Obj $parsed -Name "strings" -Default $null

            $packs[$code] = [ordered]@{
                code    = $code
                name    = $name
                locale  = $locale
                dir     = $dir
                strings = if ($stringsObj) { $stringsObj } else { @{} }
            }
            $manifestList.Add([ordered]@{
                    code = $code
                    name = $name
                    file = $lf.Name
                })
        }
        catch {
            Write-Warning "Failed to parse language file ($($lf.Name)): $($_.Exception.Message)"
        }
    }

    $manifestObj = [ordered]@{
        languages = $manifestList.ToArray()
    }
    $manifestJson = $manifestObj | ConvertTo-Json -Depth 4
    if ($manifestList.Count -eq 0) {
        $manifestJson = $manifestJson -replace '"languages":\s*null', '"languages": []'
    }
    Write-Utf8Text -Path (Join-Path $langDir "manifest.json") -Content $manifestJson

    $langsJson = if ($packs.Count -gt 0) { ($packs | ConvertTo-Json -Depth 6 -Compress) } else { "{}" }
    $safeLangsJson = $langsJson -replace '</script', '<\/script'
    $langsJs = "// Auto-generated by index-ebooks.ps1 from lang/*.json files.`r`nwindow.EBOOK_LANGS = $safeLangsJson;`r`n"
    Write-Utf8Text -Path (Join-Path $langDir "languages.js") -Content $langsJs

    Write-Host ("Language packs synced ({0} languages): {1}" -f $packs.Count, (($packs.Keys) -join ", ")) -ForegroundColor DarkCyan
}

# --- 0. Sync Language Packs ---
Sync-LanguagePacks -BaseDir $AppDir
if ($OnlyLang) {
    return
}

# --- 1. Load Configuration ---
$defaultExtensions = @(".pdf", ".epub", ".mobi", ".azw", ".azw3", ".djvu", ".fb2", ".cbr", ".cbz", ".txt", ".docx", ".rtf")
$defaultExcludes = @('$RECYCLE.BIN', "System Volume Information", ".git", ".github", ".gitignore", "node_modules", "AppData")
$extractEpub = $true
$targetFolders = @()

# Bootstrap app/config/config.json from app/config/config.example.json on a fresh clone if needed
if (-not (Test-Path -LiteralPath $ConfigPath) -and -not $Folders) {
    $exampleConfig = Join-Path (Join-Path $AppDir "config") "config.example.json"
    if (Test-Path -LiteralPath $exampleConfig) {
        Copy-Item -LiteralPath $exampleConfig -Destination $ConfigPath
        Write-Host "Created app/config/config.json from app/config/config.example.json. Edit it to add your e-book folders." -ForegroundColor Yellow
    }
}

if (Test-Path -LiteralPath $ConfigPath) {
    $configRaw = Read-Utf8Text -Path $ConfigPath
    $config = $configRaw | ConvertFrom-Json
    if (-not $Folders -and $config.PSObject.Properties["folders"]) {
        $targetFolders = @($config.folders)
    }
    if ($config.PSObject.Properties["extensions"] -and $config.extensions) {
        $defaultExtensions = @($config.extensions)
    }
    if ($config.PSObject.Properties["excludeFolders"] -and $config.excludeFolders) {
        $defaultExcludes = @($config.excludeFolders)
    }
    if ($config.PSObject.Properties["extractEpubMetadata"]) {
        $extractEpub = [bool]$config.extractEpubMetadata
    }
}
elseif (-not $Folders) {
    Write-Warning "Configuration file not found: $ConfigPath"
}

if ($Folders) {
    $targetFolders = @($Folders)
}

if ($Fast) {
    $extractEpub = $false
}

$extSet = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($ext in $defaultExtensions) {
    if (-not [string]::IsNullOrWhiteSpace($ext)) {
        $normalizedExt = $ext.Trim().ToLowerInvariant()
        if (-not $normalizedExt.StartsWith(".")) { $normalizedExt = "." + $normalizedExt }
        [void]$extSet.Add($normalizedExt)
    }
}

$excludeSet = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($ex in $defaultExcludes) {
    if (-not [string]::IsNullOrWhiteSpace($ex)) {
        [void]$excludeSet.Add($ex.Trim().ToLowerInvariant())
    }
}

# --- 2. Load Existing Database Cache ---
$dataDir = Join-Path $AppDir "data"
$jsonPath = Join-Path $dataDir "books.json"
$jsPath = Join-Path $dataDir "books.js"
$xmlPath = Join-Path $dataDir "books.xml"

$existingMap = @{}
if (-not $Force -and (Test-Path -LiteralPath $jsonPath)) {
    try {
        $oldDb = Read-JsonFast -JsonText (Read-Utf8Text -Path $jsonPath)
        $oldBooks = Get-Prop -Obj $oldDb -Name "books" -Default $null
        if ($oldBooks) {
            foreach ($b in @($oldBooks)) {
                $fp = [string](Get-Prop -Obj $b -Name "fullPath" -Default "")
                if ($fp) {
                    $existingMap[$fp.ToLowerInvariant()] = $b
                }
            }
        }
        Write-Host ("Loaded existing database cache: {0} records." -f $existingMap.Count) -ForegroundColor DarkCyan
    }
    catch {
        Write-Warning "Could not read existing books.json; performing a full scan: $($_.Exception.Message)"
        $existingMap = @{}
    }
}

# --- 3. Scan Configured Folders ---
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$nowIso = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
$seenPaths = New-Object 'System.Collections.Generic.HashSet[string]'
$indexedBooks = New-Object System.Collections.Generic.List[object]
$validScannedFolders = New-Object System.Collections.Generic.List[string]

$addedCount = 0
$updatedCount = 0
$unchangedCount = 0
$totalSizeBytes = [int64]0

$internalSkipDirs = @(
    $AppDir,
    (Join-Path $ProjectRoot ".github"),
    (Join-Path $ProjectRoot ".git"),
    (Join-Path $ProjectRoot ".gitignore")
)

# Resolve folders to scan, always including $ProjectRoot (unless already covered by a parent folder or -Folders was explicitly passed)
$foldersToScan = New-Object System.Collections.Generic.List[string]
foreach ($rawFolder in $targetFolders) {
    if ([string]::IsNullOrWhiteSpace($rawFolder)) { continue }
    $resolvedFolder = $rawFolder.Trim().TrimEnd('\')
    if (-not (Test-Path -LiteralPath $resolvedFolder -PathType Container)) {
        Write-Warning "Folder not found (skipped): $resolvedFolder"
        continue
    }
    $fullRoot = (Get-Item -LiteralPath $resolvedFolder).FullName.TrimEnd('\')
    if (-not $foldersToScan.Contains($fullRoot)) {
        $foldersToScan.Add($fullRoot)
    }
}

if (-not $Folders -and (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    $normProjectRoot = (Get-Item -LiteralPath $ProjectRoot).FullName.TrimEnd('\')
    $alreadyCovered = $false
    foreach ($existingRoot in $foldersToScan) {
        if ($normProjectRoot -ieq $existingRoot -or $normProjectRoot.StartsWith(($existingRoot + "\"), [System.StringComparison]::OrdinalIgnoreCase)) {
            $alreadyCovered = $true
            break
        }
    }
    if (-not $alreadyCovered) {
        $foldersToScan.Add($normProjectRoot)
    }
}

Write-Host ""
Write-Host "=== E-Book Indexing Started ===" -ForegroundColor Cyan

foreach ($fullRoot in $foldersToScan) {
    $rootName = Split-Path -Path $fullRoot -Leaf
    if ([string]::IsNullOrWhiteSpace($rootName)) { $rootName = $fullRoot }

    $validScannedFolders.Add($fullRoot)
    Write-Host "Scanning: $fullRoot" -ForegroundColor Yellow

    $files = Get-FilesSafe -RootPath $fullRoot -ExtSet $extSet -ExcludeSet $excludeSet -SkipDirs $internalSkipDirs
    $folderTotal = $files.Count
    $folderProcessed = 0
    Write-Host ("  -> Found {0} e-book files." -f $folderTotal) -ForegroundColor Gray

    foreach ($file in $files) {
        $folderProcessed++
        if ($folderTotal -ge 500 -and ($folderProcessed % 500 -eq 0 -or $folderProcessed -eq $folderTotal)) {
            $pct = [int][math]::Floor(($folderProcessed * 100.0) / $folderTotal)
            Write-Host ("     Processing: {0} / {1} ({2}%) - {3:N1}s" -f $folderProcessed, $folderTotal, $pct, $stopwatch.Elapsed.TotalSeconds) -ForegroundColor DarkGray
        }

        $pathKey = $file.FullName.ToLowerInvariant()
        if ($seenPaths.Contains($pathKey)) {
            continue
        }
        [void]$seenPaths.Add($pathKey)

        $lastModIso = $file.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ss")
        $sizeBytes = [int64]$file.Length
        $totalSizeBytes += $sizeBytes

        $parentDir = $file.DirectoryName
        $subFolder = ""
        if ($parentDir.Length -gt $fullRoot.Length -and $parentDir.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            $subFolder = $parentDir.Substring($fullRoot.Length).TrimStart('\')
        }

        $cached = $null
        if ($existingMap.ContainsKey($pathKey)) {
            $cached = $existingMap[$pathKey]
        }

        $cachedSize = if ($cached) { [int64](Get-Prop -Obj $cached -Name "sizeBytes" -Default -1) } else { -1 }
        $cachedMod = if ($cached) { [string](Get-Prop -Obj $cached -Name "lastModified" -Default "") } else { "" }

        if ($cached -and ($cachedSize -eq $sizeBytes) -and ($cachedMod -eq $lastModIso)) {
            # File unchanged; reuse cached metadata
            $rawTags = Get-Prop -Obj $cached -Name "tags" -Default $null
            $tagsArr = if ($rawTags) { @($rawTags) } else { @() }
            $cachedAddedAt = [string](Get-Prop -Obj $cached -Name "addedAt" -Default "")
            $record = [ordered]@{
                id             = [string](Get-Prop -Obj $cached -Name "id" -Default (Get-StableId -Text $file.FullName))
                title          = [string](Get-Prop -Obj $cached -Name "title" -Default $file.Name)
                author         = [string](Get-Prop -Obj $cached -Name "author" -Default "")
                fileName       = [string]$file.Name
                extension      = $file.Extension.TrimStart('.').ToLowerInvariant()
                sizeBytes      = $sizeBytes
                lastModified   = $lastModIso
                addedAt        = if ($cachedAddedAt) { $cachedAddedAt } else { $nowIso }
                rootFolder     = $fullRoot
                rootName       = $rootName
                subFolder      = $subFolder
                folderPath     = $parentDir
                fullPath       = $file.FullName
                fileUri        = ([System.Uri]$file.FullName).AbsoluteUri
                year           = [string](Get-Prop -Obj $cached -Name "year" -Default "")
                publisher      = [string](Get-Prop -Obj $cached -Name "publisher" -Default "")
                language       = [string](Get-Prop -Obj $cached -Name "language" -Default "")
                tags           = $tagsArr
                description    = [string](Get-Prop -Obj $cached -Name "description" -Default "")
                metadataSource = [string](Get-Prop -Obj $cached -Name "metadataSource" -Default "filename")
            }
            $indexedBooks.Add($record)
            $unchangedCount++
            continue
        }

        # New or modified file: extract metadata
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
        $extNoDot = $file.Extension.TrimStart('.').ToLowerInvariant()
        $parsed = Parse-FileNameMetadata -BaseName $baseName

        $title = $parsed.title
        $author = $parsed.author
        $year = $parsed.year
        $publisher = ""
        $language = ""
        $tags = @()
        $description = ""
        $metaSource = "filename"

        if ($extractEpub -and $extNoDot -eq "epub") {
            $epubMeta = Get-EpubMetadata -FilePath $file.FullName
            if ($epubMeta) {
                if ($epubMeta.title) { $title = $epubMeta.title }
                if ($epubMeta.author) { $author = $epubMeta.author }
                if ($epubMeta.year) { $year = $epubMeta.year }
                if ($epubMeta.publisher) { $publisher = $epubMeta.publisher }
                if ($epubMeta.language) { $language = $epubMeta.language }
                if ($epubMeta.tags) { $tags = @($epubMeta.tags) }
                if ($epubMeta.description) { $description = $epubMeta.description }
                $metaSource = "epub"
            }
        }

        $prevAddedAt = if ($cached) { [string](Get-Prop -Obj $cached -Name "addedAt" -Default "") } else { "" }
        $record = [ordered]@{
            id             = Get-StableId -Text $file.FullName
            title          = $title
            author         = $author
            fileName       = $file.Name
            extension      = $extNoDot
            sizeBytes      = $sizeBytes
            lastModified   = $lastModIso
            addedAt        = if ($prevAddedAt) { $prevAddedAt } else { $nowIso }
            rootFolder     = $fullRoot
            rootName       = $rootName
            subFolder      = $subFolder
            folderPath     = $parentDir
            fullPath       = $file.FullName
            fileUri        = ([System.Uri]$file.FullName).AbsoluteUri
            year           = $year
            publisher      = $publisher
            language       = $language
            tags           = $tags
            description    = $description
            metadataSource = $metaSource
        }

        $indexedBooks.Add($record)

        if ($cached) {
            $updatedCount++
        }
        else {
            $addedCount++
        }
    }
}

$removedCount = 0
foreach ($oldKey in $existingMap.Keys) {
    if (-not $seenPaths.Contains($oldKey)) {
        $removedCount++
    }
}

$dbObject = [ordered]@{
    schemaVersion = 1
    generatedAt   = $nowIso
    stats         = [ordered]@{
        totalBooks     = $indexedBooks.Count
        totalSizeBytes = $totalSizeBytes
        added          = $addedCount
        updated        = $updatedCount
        removed        = $removedCount
        unchanged      = $unchangedCount
        scannedFolders = $validScannedFolders.ToArray()
    }
    books         = $indexedBooks.ToArray()
}

# --- 4. Write Database Files ---
Write-Host "Writing database files..." -ForegroundColor Cyan
$jsonText = ConvertTo-JsonFast -Data $dbObject
if ($indexedBooks.Count -eq 0) {
    $jsonText = $jsonText -replace '"books":\s*null', '"books": []'
}
if ($validScannedFolders.Count -eq 0) {
    $jsonText = $jsonText -replace '"scannedFolders":\s*null', '"scannedFolders": []'
}

Write-Utf8Text -Path $jsonPath -Content $jsonText

# JS bridge file so index.html loads cleanly over file:// without CORS errors
$safeJsJson = $jsonText -replace '</script', '<\/script'
$jsContent = "// Auto-generated by index-ebooks.ps1.`r`nwindow.EBOOK_DB = $safeJsJson;`r`n"
Write-Utf8Text -Path $jsPath -Content $jsContent

if ($ExportXml) {
    Export-BooksToXml -DbObject $dbObject -XmlPath $xmlPath
}

$stopwatch.Stop()

Write-Host ""
Write-Host ("=== Indexing Completed ({0:N2}s) ===" -f $stopwatch.Elapsed.TotalSeconds) -ForegroundColor Green
Write-Host ("  Total Books : {0}" -f $indexedBooks.Count)
Write-Host ("  Added       : {0}" -f $addedCount) -ForegroundColor Green
Write-Host ("  Updated     : {0}" -f $updatedCount) -ForegroundColor Cyan
Write-Host ("  Removed     : {0}" -f $removedCount) -ForegroundColor DarkYellow
Write-Host ("  Unchanged   : {0}" -f $unchangedCount) -ForegroundColor Gray
Write-Host ("  JSON Output : {0}" -f $jsonPath)
Write-Host ("  JS Bridge   : {0}" -f $jsPath)
if ($ExportXml) {
    Write-Host ("  XML Output  : {0}" -f $xmlPath)
}

if ($validScannedFolders.Count -eq 0) {
    Write-Host ""
    Write-Host "WARNING: No valid folders were found. Update the 'folders' list in config.json with your e-book directories." -ForegroundColor Yellow
}
