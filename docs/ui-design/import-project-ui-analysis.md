# COVAI Import Project UI — Implementation Analysis

## 1. Overview

The **Import Project interface** (Section 2.4 — Import Project) provides the primary onboarding and codebase ingestion gateway for developers on the COVAI platform. Its purpose is to ingest existing software repositories into the COVAI workspace so that the system can construct Abstract Syntax Trees (AST), map Control Flow Graphs (CFG), detect existing test frameworks (specifically Jest), identify uncovered execution branches, and synthesize deterministic unit tests.

The interface is implemented as an interactive, multi-channel modal dialog (`ImportLayout.jsx`) rendered via a React Portal (`createPortal(..., document.body)`). It provides two distinct codebase ingestion channels arranged in a balanced two-column desktop layout:

1. **Left Panel — Local Ingest (Compressed Archive Upload):**
   - Allows developers to upload compressed project archives (`.zip` or `.rar`) up to a verified limit of 200MB.
   - Provides a drag-and-drop dropzone, local file browser trigger, dynamic file metadata inspection, client-triggered pre-flight language and security scanning, secret sanitization, and automated background pipeline ingestion into cloud storage and snapshot records.
2. **Right Panel — GitHub Integration (URL Import & Account Repository Browser):**
   - **Direct URL Import:** Allows direct import of public (or authorized private) repositories by pasting a GitHub repository URL (`https://github.com/owner/repo`).
   - **Account Repository Selector:** Checks the developer's connected GitHub profile, fetches their GitHub repositories via authenticated backend API calls, provides real-time client-side search filtering, 5-item-per-page pagination, language compatibility gating (strict JavaScript/TypeScript support), and single-click repository cloning and snapshot creation.

The frontend is built with **React 19**, **Vite**, **Lucide React** icons, and styled with **Tailwind CSS v4** utilizing semantic CSS variables (`var(--color-surface)`, `var(--color-primary)`, `var(--color-border)`, etc.) defined in `client/src/index.css`. The backend runs on **Node.js** with **Express**, **Prisma ORM** (PostgreSQL), **Multer** for file handling, **Google Cloud Storage / Firebase Cloud Storage** for archive persistence, **node-unrar-js** and **unzipper** for archive inspection, and native child-process `git clone` execution for GitHub repository retrieval.

---

## 2. Implementation Files

The following table documents all frontend and backend source files responsible for the Import Project modal, file upload processing, archive sanitization, GitHub integration, and snapshot creation:

| File Path | Component/Function | Responsibility | Evidence |
|---|---|---|---|
| `client/src/components/dashboard/import/ImportLayout.jsx` | `ImportLayout` | Main modal shell and portal manager; renders backdrop, header, 2-column split grid, footer, Esc key listener, backdrop dismiss, user GitHub status detection, and post-import success overlay. | Lines 33–211: `createPortal`, `useEffect` listening to `Escape`, `getUserProfileApi()`, Lucide `FolderGit2`, `Zap`, `Shield`, `HelpCircle`, and `X` close trigger. |
| `client/src/components/dashboard/import/LocalUpload.jsx` | `LocalUpload` | Local archive ingestion component; manages drag-and-drop states (`idle`, `over`, `dropped`), file selection, pre-flight archive validation, language badge display, error cards, project creation, and archive upload. | Lines 40–434: `handleDragOver`, `handleDrop`, `handleFileSelect`, `checkArchive()`, `validateArchiveApi()`, `createProjectApi()`, `uploadZipApi()`, `#browse-files-btn`, `#upload-import-btn`. |
| `client/src/components/dashboard/import/GitHubImport.jsx` | `GitHubImport` | GitHub ingestion wrapper; manages GitHub URL input, syntax validation, direct URL import dispatch, divider rendering, and conditional rendering of `RepoList` or OAuth connect fallback. | Lines 27–212: `isValidUrl` regex check, `handleImportUrl()`, `#github-url-input`, `#url-import-btn`, `#connect-github-import-btn`, conditional OAuth authorization anchor. |
| `client/src/components/dashboard/import/RepoList.jsx` | `RepoList`, `RepoItem` | Authenticated GitHub repository selector; fetches user repositories from backend, manages real-time search filtering, 5-item pagination, language color mapping, language compatibility checks, and repo import dispatch. | Lines 39–183 (`RepoItem`), Lines 186–338 (`RepoList`): `getGithubRepositoriesApi()`, client search filter, `reposPerPage = 5`, `Math.ceil(repos/5)` pagination, `getLangColor()`, JS/TS gating, `#repo-search-input`. |
| `client/src/services/project.service.js` | API Client | Centralized HTTP service wrapper for project creation, archive validation, archive upload, GitHub URL import, GitHub repo import, and repository list fetching. | Lines 29–36 (`createProjectApi`), Lines 60–76 (`validateArchiveApi`), Lines 78–95 (`uploadZipApi`), Lines 97–107 (`importGithubUrlApi`), Lines 109–119 (`importGithubRepoApi`), Lines 121–134 (`getGithubRepositoriesApi`), Lines 193–198 (`getUserProfileApi`). |
| `server/src/routes/project.route.js` | Express Router | Defines authenticated API endpoints for project creation, archive validation, and archive upload. | Lines 16–43: `POST /`, `POST /validate-archive` (`uploadSingleArchive`, `projectController.validateArchive`), `POST /:id/upload-zip` (`uploadSingleArchive`, `projectController.uploadZip`). |
| `server/src/routes/github.route.js` | Express Router | Defines authenticated endpoints for cloning GitHub repositories by URL and by account repository info. | Lines 10–20: `POST /projects/:projectId/import-github-url` (`cloneGitHubRepositoryByUrl`), `POST /projects/:projectId/import-github-repo` (`importGitHubRepository`). |
| `server/src/routes/auth.route.js` | Express Router | Defines authentication and GitHub integration routes including OAuth callback and repository listing. | Lines 26–28: `GET /github/callback`, `POST /github/access`, `GET /github/repositories` (`authMiddleware`, `getGithubRepositories`). |
| `server/src/controllers/project.controller.js` | `ProjectController` | Controller implementing archive pre-flight validation and archive upload dispatching. | Lines 132–165 (`createProject`), Lines 545–587 (`validateArchive`), Lines 592–620 (`uploadZip`). |
| `server/src/controllers/github.controller.js` | GitHub Controllers | Controllers implementing public GitHub URL cloning and authenticated GitHub account repository importing. | Lines 9–94 (`cloneGitHubRepositoryByUrl`), Lines 96–212 (`importGitHubRepository`). |
| `server/src/controllers/auth.controller.js` | Auth Controllers | Handles retrieving user's encrypted GitHub token and querying GitHub API for repository listings. | Lines 76–134: `getGithubRepositories` (retrieves `githubAccessTokenEnc`, decrypts token, paginates GitHub API `https://api.github.com/user/repos`, returns array). |
| `server/src/middlewares/upload.middleware.js` | Multer & Security Scanner | Multer storage configuration and security scanner guarding against archive bombs, path traversals, symlinks, and blacklisted secret files. | Lines 26–59 (`MAX_FILE_SIZE = 200MB`, file filter `.zip` and `.rar`), Lines 61–192 (`scanArchiveBomb`: checks `.env`, `.pem`, `.key`, symlinks, max 10,000 files, max 1GB uncompressed, max 150:1 ratio). |
| `server/src/utils/languageDetector.js` | Language Detector | Inspects compressed archive contents or directory trees to verify if JavaScript or TypeScript is the primary project language. | Lines 10–62 (language extension mappings), Lines 110–205 (`detectLanguageFromPaths`), Lines 213–249 (`detectLanguageFromDirectory`), Lines 259–299 (`validateArchiveLanguage`). |
| `server/src/services/project.service.js` | `uploadProjectZip` | Server service orchestrating archive checksumming, duplicate detection, Firebase Cloud Storage upload, snapshot extraction, Jest detection, and job tracking. | Lines 214–400: `scanArchiveBomb`, `validateArchiveLanguage`, sha256 hashing, `createSnapshotIngestJob`, Firebase stream upload, `extractZipSnapshot`, `detectJest`, database snapshot creation. |
| `server/src/services/githubClone.service.js` | `GitHubCloneService` | Service executing native Git clone commands in isolated storage directories, retrieving commit SHA and default branch. | Lines 23–116: Handles unauthenticated clone URL or `x-access-token` clone URL, executes `git clone`, extracts commit SHA, detects default branch, configures local git author, purges committed `node_modules`. |
| `server/src/services/github.service.js` | `GitHubRepositoryAccessService` | Retrieves and decrypts the authenticated user's stored GitHub personal access token from PostgreSQL database. | Lines 11–26: `getGitHubToken(userId)` querying `user.githubAccessTokenEnc` and invoking AES decryption. |
| `server/src/utils/jestDetector.js` | `detectJest` | Inspects project directory for Jest / Vitest / Playwright configuration files and scripts. | Lines 1–80: Scans `package.json`, detects Jest config files (`jest.config.js`, `jest.config.ts`, etc.), returns `hasJest` flag and execution commands. |
| `server/src/services/zipExtraction.service.js` | `extractZipSnapshot` | Extracts validated archive files from temporary disk or buffer into permanent project directory. | Lines 1–70: Handles `.zip` and `.rar` extraction into `storage/projects/{projectId}/snapshots/{snapshotId}`. |

---

## 3. UI Specification

The following five-column specification table details all 48 visible, interactive, conditional, and structural elements of the COVAI Import Project modal dialog:

| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `ModalOverlay` | Modal Backdrop | `fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs`; click listener attached (`onClick={onClose}`). | Obscures the underlying dashboard workspace and dismisses the modal when clicked. |
| 2 | `ModalCardContainer` | Modal Container | `w-full max-w-5xl max-h-[90vh] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-xl)] shadow-xl flex flex-col overflow-hidden text-[var(--color-text)] font-sans relative`; stops click propagation. | Encapsulates the entire Import Project interface and restricts vertical height to 90vh. |
| 3 | `ModalHeader` | Modal Header Bar | `h-14 px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between shrink-0`. | Displays modal identity, release scope, keyboard shortcut hint, and close control. |
| 4 | `HeaderBrandIcon` | Icon Container | `w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white flex items-center justify-center shrink-0`; renders Lucide `FolderGit2` (`size={16}`). | Visual icon branding representing repository and project management. |
| 5 | `HeaderTitle` | Text Heading (`<h2>`) | Visible text: `"Import Project"`; styling: `font-bold text-sm tracking-tight text-[var(--color-text)]`; `id="import-modal-title"`. | Identifies the primary purpose of the modal dialog. |
| 6 | `HeaderHubBadge` | Badge | Visible text: `"Hub"`; `<Badge variant="primary" size="sm">`; purple background with white text. | Designates the dialog as the centralized project ingestion hub. |
| 7 | `HeaderEscHint` | Keyboard Hint Badge | Visible text: `"Esc"`; `hidden sm:inline-block text-[11px] font-mono text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-[var(--radius-sm)] px-1.5 py-0.5`. | Informs desktop users that pressing the Escape key dismisses the modal. |
| 8 | `HeaderCloseButton` (`#import-cancel-btn`) | Icon Button | `p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer`; renders Lucide `X` (`size={16}`). | Triggers `onClose()` to dismiss the modal without initiating an import. |
| 9 | `ModalBodyGrid` | 2-Column Grid Container | `flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 min-h-[500px]`. | Splits modal into Left Panel (5 columns) and Right Panel (7 columns). |
| 10 | `LeftPanelContainer` | Left Column Container | `lg:col-span-5 p-6 border-b lg:border-b-0 lg:border-r border-[var(--color-border)] flex flex-col justify-between bg-[var(--color-surface)]`. | Encloses the local codebase archive ingestion flow. |
| 11 | `LocalIngestTag` | Category Badge / Label | `inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-2`; renders Lucide `Zap` (`size={13}`) + text `"LOCAL INGEST"`. | Categorizes the section as local machine codebase ingestion. |
| 12 | `LocalIngestHeading` | Text Heading (`<h3>`) | Visible text: `"Upload Codebase Archive"`; styling: `text-base font-bold text-[var(--color-text)] tracking-tight`. | Section heading for compressed file upload. |
| 13 | `LocalIngestDescription` | Descriptive Text (`<p>`) | Visible text: `"Upload a compressed archive (.zip or .rar). AST and cyclomatic complexity graphs are synthesized automatically."` with `.zip` and `.rar` styled in `<code>` tags. | Explains supported archive formats and automatic AST/CFG synthesis. |
| 14 | `DropzoneArea` (`#dropzone-area`) | File Upload Area | `relative flex flex-col items-center justify-center flex-1 rounded-[var(--radius-lg)] border-2 border-dashed p-6 transition-colors min-h-[300px]`; dynamic border colors (primary on hover, success on valid drop, danger on invalid drop). | Drag-and-drop dropzone receiving dragged files or triggering hidden file picker. |
| 15 | `DropzoneIcon` | Icon Container | `w-12 h-12 rounded-[var(--radius-lg)] flex items-center justify-center bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-primary)]`; renders Lucide `CloudUpload` (`size={24}`). | Visual cue indicating archive upload capability. |
| 16 | `DropzoneTitle` | Text Heading (`<h3>`) | Visible text: `"Upload Project Archive"`; styling: `text-sm font-semibold text-[var(--color-text)] tracking-tight`. | Sub-heading inside idle dropzone area. |
| 17 | `DropzoneSubtitle` | Descriptive Text (`<p>`) | Visible text: `"Drag and drop your codebase archive here to parse and synthesize tests"`; styling: `text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed`. | Actionable instruction for dragging files into the dropzone. |
| 18 | `DropzoneZipBadge` | Badge | Visible text: `".ZIP"`; `<Badge variant="neutral" size="sm">`; subtle gray background. | Informs user of ZIP archive support. |
| 19 | `DropzoneRarBadge` | Badge | Visible text: `".RAR"`; `<Badge variant="neutral" size="sm">`; subtle gray background. | Informs user of RAR archive support. |
| 20 | `DropzoneSizeLimit` | Text Label | Visible text: `"Max 200MB"`; styling: `text-[11px] text-[var(--color-text-muted)] font-mono`. | Displays the maximum supported archive file size. |
| 21 | `BrowseFilesButton` (`#browse-files-btn`) | Action Button | Visible text: `"Browse Local Files"`; `<Button variant="secondary" size="sm">`; renders Lucide `HardDrive` (`size={14}`); stop-propagation on click. | Spawns programmatic file selection dialog. |
| 22 | `HiddenFileInput` | HTML File Input (Inferred/Dynamic) | Programmatically created `document.createElement("input")`; `type="file"`; `accept=".zip,.rar,.tar.gz"`; hidden from visual rendering. | Native OS file picker interface receiving selected file from file system. |
| 23 | `DroppedFileCard` | File Metadata Card | Conditionally rendered when `isDropped === true`; `w-full rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] p-3 flex flex-col gap-2.5`. | Replaces idle dropzone graphics with selected file details and status. |
| 24 | `DroppedFileName` | Text (Filename) | Visible text: `{fileName}`; styling: `text-xs font-semibold text-[var(--color-text)] truncate font-mono`. | Displays the exact original filename of the selected archive. |
| 25 | `DroppedFileSize` | Text (Size) | Formatted byte size (e.g., `"12.4 MB"`); styling: `text-[11px] text-[var(--color-text-muted)] font-mono`. | Displays the human-readable byte size of the selected archive. |
| 26 | `DroppedFileTypeBadge` | Badge | Visible text: `"ZIP Archive"` or `"RAR Archive"`; `<Badge variant={isRar ? "warning" : "primary"} size="sm">`. | Indicates detected archive format. |
| 27 | `DroppedFileRemoveButton` | Icon Button | `p-1 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]`; renders Lucide `X` (`size={14}`); triggers `handleClear()`. | Resets upload state back to idle dropzone. |
| 28 | `DroppedFileLanguageStatus` | Status Row / Badge | Displays `Loader2` spinner during check, `<Badge variant="success">` for detected language, or `<Badge variant="danger">Unsupported</Badge>` if invalid. | Displays the detected primary language from pre-flight validation. |
| 29 | `DroppedFileErrorCard` | Alert Banner (Conditional) | `w-full rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 p-3 flex items-start gap-2.5 text-[var(--color-danger)] text-xs`. | Displays detailed language incompatibility or archive corruption errors. |
| 30 | `DroppedFileImportButton` (`#upload-import-btn`) | Submit Action Button | Label cycles: `"Import Project"`, `"Checking Language..."`, `"Extracting & Ingesting..."`, or `"Unsupported Project"`; `<Button variant="primary">`. | Triggers project creation and binary upload via `uploadZipApi()`. |
| 31 | `SafeUploadNotice` | Security Banner / Text | Visible text: `"Safe upload: archives are scanned and cleaned of secrets locally."`; renders Lucide `Shield` (`size={13}`) in emerald green; `pt-4 mt-4 border-t`. | Assures developers of secret sanitization and local security checks. |
| 32 | `RightPanelContainer` | Right Column Container | `lg:col-span-7 p-6 flex flex-col relative bg-[var(--color-surface)]`. | Encloses GitHub URL ingestion and repository selection. |
| 33 | `GitHubUrlSectionHeading` | Section Heading (`<label>`) | `htmlFor="github-url-input"`; visible text: `"IMPORT VIA GITHUB URL"` with purple bullet point dot; `text-xs font-semibold uppercase tracking-wider`. | Section title for repository URL import. |
| 34 | `GitHubUrlVisibilityLabel` | Text Label | Visible text: `"Public or Private repos"`; styling: `text-[11px] text-[var(--color-text-muted)] font-mono`. | Informs users that both public and authenticated private repos are supported. |
| 35 | `GitHubUrlInputContainer` | Input Field Wrapper | `flex items-center flex-1 rounded-[var(--radius-md)] px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] focus-within:border-[var(--color-primary)]`. | Container grouping input field, link icon, and validation badge. |
| 36 | `GitHubUrlLinkIcon` | Icon Container | Lucide `Link2` (`size={15}`) with `text-[var(--color-text-muted)] shrink-0 mr-2`. | Visual cue indicating web hyperlink input. |
| 37 | `GitHubUrlInputField` (`#github-url-input`) | Text Input Field | Controlled input; `placeholder="https://github.com/organization/repository"`; `font-mono text-xs text-[var(--color-text)] outline-none`. | Receives GitHub repository URL from user. |
| 38 | `GitHubUrlValidationBadge` | Status Indicator (Conditional) | Green `CheckCircle2` (`size={15}`) if valid GitHub URL; amber dot (`w-2 h-2 rounded-full bg-amber-400`) if non-empty but incomplete. | Real-time URL format validity feedback. |
| 39 | `GitHubUrlImportButton` (`#url-import-btn`) | Submit Action Button | Visible text: `"Import"`; `<Button variant="primary" size="md">`; renders Lucide `ArrowRight`; disabled if URL invalid or importing. | Triggers project creation and executes `importGithubUrlApi()`. |
| 40 | `DividerOrSelectFromAccount` | Section Divider | `flex items-center gap-3`; horizontal lines with centered text `"OR SELECT FROM ACCOUNT"` in uppercase font-mono. | Visually separates URL import from account repository browser. |
| 41 | `ConnectedAccountInfo` | User Badge Container | Top-left of repository browser; displays `User` icon (`size={12}`) in rounded box, username `{ownerName}`, and repo count `({count} repos)`. | Identifies the connected GitHub account and number of repositories. |
| 42 | `RepoSearchInput` (`#repo-search-input`) | Search Input Field | `w-44 sm:w-48 pl-8 pr-2.5 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--color-bg)] border border-[var(--color-border)]`; Lucide `Search` (`size={13}`). | Client-side search input filtering repositories in real-time. |
| 43 | `RepoListScrollContainer` | Scrollable List Container | `flex flex-col gap-2 overflow-y-auto max-h-[280px] pr-1`. | Scrollable container holding up to 5 repository cards per page. |
| 44 | `RepoItemCard` (`#repo-item-${id}`) | Repository Card | Row container; `group flex items-center justify-between p-3 rounded-[var(--radius-md)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-secondary)] border border-[var(--color-border)]`. | Displays single repository metadata, language dot, update date, and action button. |
| 45 | `RepoItemLanguageDot` | Color Dot Indicator | `w-2 h-2 rounded-full inline-block`; dynamic color from `getLangColor(lang)` (e.g., `#3178c6` for TypeScript, `#e34c26` for HTML). | Visual representation of primary programming language. |
| 46 | `RepoItemUnsupportedBadge` | Status Badge (Conditional) | Visible text: `"Unsupported"`; `text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 text-[var(--color-danger)] font-medium`. | Highlights repositories not supported by COVAI (non-JS/TS). |
| 47 | `RepoItemImportButton` (`#repo-import-${id}`) | Action Button | Visible text: `"Import"` (enabled, secondary) or `"Not Supported"` (disabled, ghost variant). | Triggers repository clone and import into COVAI workspace. |
| 48 | `PaginationControls` | Pagination Bar | Bottom of repo list; displays `"Page {current} of {total}"` with `ChevronLeft` and `ChevronRight` buttons. | Allows pagination across connected GitHub repositories (5 per page). |
| 49 | `OAuthConnectCard` | OAuth Fallback Container | Displayed when `hasGithub === false`; centered card with GitHub icon, title `"Connect GitHub Account"`, and button `#connect-github-import-btn`. | Prompts unauthenticated users to link their GitHub account via OAuth. |
| 50 | `ModalFooter` | Modal Footer Bar | `h-11 px-6 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs text-[var(--color-text-muted)] shrink-0`. | Bottom bar providing help guidance and modal cancellation. |
| 51 | `FooterHelpText` | Static Descriptive Text | Visible text: `"Need help? Check our workspace import guide."`; renders Lucide `HelpCircle` (`size={13}`); non-hyperlinked text. | Contextual help notice for users requiring assistance. |
| 52 | `FooterCancelButton` | Action Button | Visible text: `"Cancel"`; `<Button variant="secondary" size="sm">`; click triggers `onClose()`. | Dismisses the modal dialog without making any changes. |
| 53 | `SuccessOverlay` | Status Overlay (Conditional) | `absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs`; Lucide `CheckCircle2` (`size={24}`), heading `"Import Initialized!"`, subtitle. | Confirms successful job creation and delays 1.2s before redirecting. |

---

## 4. Local Archive Import Flow

The Local Ingest flow allows developers to upload zipped codebases directly from their machines. The implementation executes the following verified sequence:

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant UI as LocalUpload (Client)
    participant API as Express Router & Multer
    participant Sec as upload.middleware & languageDetector
    participant Svc as project.service.js
    participant GCS as Firebase Storage / Local FS
    participant DB as PostgreSQL (Prisma)

    Dev->>UI: Selects .zip or .rar (Drag-drop or Browse)
    UI->>UI: Renders dropped file card (Name, Size, Format)
    UI->>API: POST /api/projects/validate-archive (Multipart file)
    API->>Sec: scanArchiveBomb() & validateArchiveLanguage()
    Sec-->>API: Passes security check & returns detected language
    API-->>UI: 200 OK { isSupported: true, primaryLanguage: "TypeScript" }
    UI->>UI: Renders green Language Badge & enables "Import Project"
    Dev->>UI: Clicks "Import Project" button
    UI->>API: POST /api/projects (Creates project with archive name)
    API->>DB: prisma.project.create()
    DB-->>API: Returns { id: projectId }
    API-->>UI: Project created
    UI->>API: POST /api/projects/:id/upload-zip (Multipart file)
    API->>Sec: scanArchiveBomb() & validateArchiveLanguage()
    API->>Svc: uploadProjectZip({ projectId, file, userId })
    Svc->>Svc: Calculates SHA-256 Checksum
    Svc->>DB: Checks duplicate snapshot (checksum + projectId)
    Svc->>GCS: Streams archive to Firebase Cloud Storage (or local fallback)
    Svc->>Svc: extractZipSnapshot() to local snapshot directory
    Svc->>Svc: detectJest() & resolveProjectRoot()
    Svc->>DB: prisma.projectSnapshot.create() & prisma.project.update()
    Svc->>Svc: createSnapshotIngestJob() (tracks 50% -> 90% -> 100%)
    API-->>UI: 200 OK { snapshot, job }
    UI->>UI: Displays Toast & Success Overlay ("Import Initialized!")
    UI->>Dev: Redirects to Workspace / Closes Modal
```

### 4.1 Detailed Flow Stages

1. **File Selection:**
   - The user selects a file either by dropping it onto the dashed dropzone (`#dropzone-area`) or by clicking `"Browse Local Files"` (`#browse-files-btn`).
   - The hidden `<input type="file">` specifies `accept=".zip,.rar,.tar.gz"`.
   - Upon receiving the file, `LocalUpload.jsx` updates local state (`fileObj`, `fileName`, and sets `dragState = "dropped"`).

2. **Pre-Flight Validation (`checkArchive`):**
   - The client immediately dispatches `POST /api/projects/validate-archive` via `validateArchiveApi(file)` before creating any project record.
   - Multer middleware intercepts the upload (`MAX_FILE_SIZE = 200MB`, file extensions `.zip` or `.rar`).
   - The server executes `scanArchiveBomb()`:
     - Rejects nested archives (`.zip`, `.rar` inside the archive).
     - Checks file entry counts (max 10,000 files).
     - Rejects path traversal (`..` or absolute paths).
     - Forbids symlinks.
     - **Secret Sanitization Check:** Specifically rejects blacklisted secret extensions (`.env`, `.pem`, `.key`).
     - Detects abnormal compression ratios (> 150:1).
   - The server executes `validateArchiveLanguage()` (`server/src/utils/languageDetector.js`):
     - Scans file extensions in memory without full disk extraction.
     - If the project does not contain JavaScript/TypeScript files or a `package.json`, it is marked unsupported.
     - Returns `{ isSupported: true, primaryLanguage: "TypeScript" | "JavaScript", reason: "..." }`.
   - The temporary validation file on disk (`uploads/temp`) is immediately deleted in a `finally` block.
   - The UI displays the detected language badge. If unsupported, it displays a red `"Unsupported"` badge, disables the import button, and displays an alert card.

3. **Project Provisioning:**
   - When the user clicks `"Import Project"`, `handleUpload()` strips the file extension to generate the project name.
   - Calls `createProjectApi({ name: projectName })`.
   - If a duplicate project name error occurs, it queries existing projects via `getProjectsApi()` and reuses the existing project ID.

4. **Archive Upload and Snapshot Creation:**
   - The client invokes `uploadZipApi(projectId, fileObj)` -> `POST /api/projects/:id/upload-zip`.
   - The server calculates the SHA-256 hash of the archive to ensure idempotency. If a snapshot with identical checksum exists for this project, it returns HTTP 409 (`"Duplicate snapshot already exists"`).
   - The archive is saved to Firebase Cloud Storage via `getBucket().file(storagePath)`.
   - Simultaneously, `extractZipSnapshot()` extracts the files into `storage/projects/{projectId}/snapshots/{snapshotId}`.
   - Temporary upload files are deleted (`fs.unlinkSync`).
   - The server runs `resolveProjectRoot()`, validates Node.js project structure, and invokes `detectJest()` to discover Jest configuration files and test scripts.
   - A `ProjectSnapshot` record is created in PostgreSQL with `source = "UPLOAD"`, `rootDir`, `hasJest`, and `testingFrameworksJson`.
   - A background ingestion job (`IngestJob`) updates progress from 50% to 90% to 100%.

5. **Client Feedback:**
   - The client displays an info toast: `""{projectName}" is being processed. Track progress in Job Queue."`.
   - `ImportLayout.jsx` displays `SuccessOverlay` (`"Import Initialized!"`), waits 1,200ms, and invokes `onSuccess()` to redirect the developer to the workspace.

---

## 5. GitHub URL Import Flow

The GitHub URL import allows direct ingestion of any GitHub repository accessible via standard git protocol:

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant UI as GitHubImport (Client)
    participant API as github.controller.js
    participant Git as GitHubCloneService
    participant Lang as languageDetector.js
    participant Jest as jestDetector.js
    participant DB as PostgreSQL (Prisma)

    Dev->>UI: Enters "https://github.com/org/repo"
    UI->>UI: Validates format (starts with https://github.com/ and length > 22)
    UI->>UI: Displays green checkmark indicator
    Dev->>UI: Clicks "Import" button
    UI->>API: POST /api/projects (Extracts repo name, provisions project)
    API-->>UI: Returns projectId
    UI->>API: POST /api/github/projects/:projectId/import-github-url { url }
    API->>Git: cloneRepository(null, projectId, owner, repo, false)
    Git->>Git: Executes "git clone https://github.com/owner/repo.git"
    Git->>Git: Extracts commit SHA & default branch
    Git->>Git: Configures local git author & removes node_modules
    API->>Lang: detectLanguageFromDirectory(localPath)
    alt Language is NOT JavaScript or TypeScript
        Lang-->>API: isSupported = false
        API->>Git: Deletes cloned directory (fs.rmSync)
        API-->>UI: 400 Bad Request { message: "Unsupported project..." }
        UI->>Dev: Displays Error Alert Banner
    else Language Supported
        Lang-->>API: isSupported = true
        API->>Jest: detectJest(resolvedRootDir)
        API->>DB: prisma.projectSnapshot.create() (source: "GITHUB", commitSha, etc.)
        API->>DB: prisma.project.update() (repoUrl, defaultBranch)
        API->>API: buildCfgForSnapshot(snapshot.id) in background
        API-->>UI: 200 OK { snapshotId, testingFrameworks }
        UI->>UI: Shows Toast & Success Overlay
        UI->>Dev: Redirects to Workspace
    end
```

### 5.1 Validation and Execution Mechanics

1. **Input Validation:**
   - Evaluated reactively: `urlValue.startsWith("https://github.com/") && urlValue.length > 22`.
   - Valid URL triggers green `CheckCircle2` icon. Incomplete/invalid URL renders an amber status dot.
   - The `"Import"` button remains disabled until the URL meets the validation criteria.

2. **Project Provisioning:**
   - Extracts repository name using regex: `urlValue.match(/github\.com\/([^/]+)\/([^/]+)/)`.
   - Provisions a project record via `createProjectApi({ name: repoName, repoUrl: urlValue })`.

3. **Repository Cloning:**
   - Invokes `importGithubUrlApi(projectId, urlValue)` -> `POST /api/github/projects/:projectId/import-github-url`.
   - Dispatches to `GitHubCloneService.cloneRepository(null, projectId, owner, repo, false)`.
   - Uses `git clone https://github.com/${owner}/${repo}.git .` into `storage/projects/{projectId}/github/{timestamp}/repo`.
   - Note: Cloning by URL is treated as public repository access (no user access token injected).

4. **Language & Framework Enforcement:**
   - The server inspects the cloned directory using `detectLanguageFromDirectory(cloneResult.localPath)`.
   - If non-JS/TS code dominates, the server deletes the cloned folder (`fs.rmSync`), aborts snapshot creation, and returns HTTP 400 with the rejection reason.
   - If valid, Jest configurations are scanned via `detectJest(resolvedRootDir)`.
   - A `ProjectSnapshot` record is created in PostgreSQL with `source = "GITHUB"`, commit SHA, local directory path, and testing framework JSON.
   - Background CFG synthesis is triggered asynchronously via `buildCfgForSnapshot(snapshot.id)`.

---

## 6. GitHub Account Repository Selection

The account repository browser allows developers with connected GitHub accounts to select and import repositories with a single click:

### 6.1 Account Verification & OAuth Gating

1. When `ImportLayout.jsx` mounts, it calls `getUserProfileApi()` (`GET /api/users/me`).
2. It inspects `data?.githubUserId || data?.user?.githubUserId`:
   - **If unlinked (`hasGithub === false`):** The repository list is replaced by `OAuthConnectCard` displaying a GitHub logo, title `"Connect GitHub Account"`, description, and an anchor button pointing to:
     `https://github.com/login/oauth/authorize?client_id=${VITE_GITHUB_CLIENT_ID}&scope=repo,user:email`.
   - **If linked (`hasGithub === true`):** `RepoList.jsx` mounts and automatically calls `getGithubRepositoriesApi()`.

### 6.2 Repository Querying & Token Decryption

1. Frontend calls `GET /api/auth/github/repositories`.
2. Backend controller `getGithubRepositories` (`server/src/controllers/auth.controller.js:76`):
   - Fetches the user record from PostgreSQL and retrieves `user.githubAccessTokenEnc`.
   - Decrypts the token using AES-256 decryption (`server/src/utils/crypto.js`).
   - Issues authenticated paginated requests to GitHub API:
     `https://api.github.com/user/repos?per_page=15&page=${page}&sort=created&direction=desc`
     with `Authorization: Bearer ${accessToken}` and `Accept: application/vnd.github.v3+json`.
   - Aggregates all user repositories and returns them as a JSON array.

### 6.3 Client-Side Search, Pagination, and Language Gating

- **Account Header:** Displays `User` icon, owner username (`repos[0]?.owner` or `"Connected Account"`, shown as `quy7373` in the screenshot), and total count `(${filteredRepos.length} repos)`.
- **Real-Time Filtering:** `input#repo-search-input` filters by repository name (`r.name.toLowerCase().includes(searchQuery.toLowerCase())`). Typing in search automatically resets pagination to Page 1.
- **Pagination Mechanics:**
  - Enforces `reposPerPage = 5`.
  - Calculates `totalPages = Math.ceil(filteredRepos.length / 5) || 1`.
  - Screenshot displays 20 repositories: `Math.ceil(20 / 5) = 4` pages -> displays `"Page 1 of 4"`.
  - Previous chevron button disabled when `currentPage === 1`.
  - Next chevron button disabled when `currentPage === totalPages`.
- **Language Color Mapping:**
  `getLangColor(lang)` maps languages to exact GitHub dot colors:
  - TypeScript: `#3178c6` (Blue dot)
  - JavaScript: `#f1e05a` (Yellow dot)
  - HTML: `#e34c26` (Red/Orange dot)
  - Python: `#3572A5`
  - Vue: `#41b883`
  - Go: `#00add8`
  - Rust: `#dea584`
  - Java: `#b07219`
- **Language Compatibility Enforcement:**
  - Evaluates `isSupported = !repo.language || repo.language === "JavaScript" || repo.language === "TypeScript"`.
  - **Supported (e.g. `test1`, `test2`, `test3`):** Renders colored dot, language label, update timestamp, and an active `"Import"` button (`variant="secondary"`).
  - **Unsupported (e.g. `SmartCommer` with HTML):** Renders language dot, language name, a red status badge `<span className="bg-danger/10 text-danger">Unsupported</span>`, and a disabled button displaying `"Not Supported"` (`variant="ghost"`, `disabled={true}`).

### 6.4 Repository Import Execution

1. Developer clicks `"Import"` on a supported repository item.
2. `RepoItem` extracts `repo.owner` and `repo.name`.
3. Creates or finds project via `createProjectApi({ name: repo.name, repoUrl })`.
4. Calls `importGithubRepoApi(projectId, repo.owner, repo.name)` -> `POST /api/github/projects/:projectId/import-github-repo`.
5. Backend clones using authenticated URL:
   `https://x-access-token:${accessToken}@github.com/${owner}/${repo}.git`.
6. Validates project language, resolves root directory, detects Jest, creates snapshot, updates project, and returns snapshot ID.

---

## 7. Validation, Progress, and Error States

### 7.1 Validation Matrix

| Target Feature | Validation Rule | Enforcing Layer | Failure Response |
|---|---|---|---|
| Archive Format | Must be `.zip` or `.rar` | Frontend file picker & Backend Multer filter | Native picker limits selection; Multer returns 400: `"Only .zip and .rar files are accepted!"`. |
| Archive Size | Maximum 200MB (compressed) | Backend Multer limits (`MAX_FILE_SIZE = 200 * 1024 * 1024`) | Multer returns 400: `"File too large"`. |
| Uncompressed Size | Maximum 1GB uncompressed | Backend `scanArchiveBomb` | Error: `"Total uncompressed size exceeds the maximum limit."`. |
| File Count Limit | Maximum 10,000 files in archive | Backend `scanArchiveBomb` | Error: `"Archive contains too many files."`. |
| Archive Bomb Ratio | Maximum 150:1 compression ratio | Backend `scanArchiveBomb` | Error: `"Abnormal compression ratio, suspected archive bomb."`. |
| Secret Leakage Prevention | Disallows `.env`, `.pem`, `.key` | Backend `scanArchiveBomb` | Error: `"Disallowed file detected: {filepath}"`. |
| Path Traversal Prevention | Rejects `..` and absolute paths | Backend `scanArchiveBomb` | Error: `"Path traversal detected in archive."`. |
| Symlink Injection | Forbids symlink entries | Backend `scanArchiveBomb` | Error: `"Symlinks are not allowed in archive."`. |
| Nested Archives | Forbids `.zip` or `.rar` inside archive | Backend `scanArchiveBomb` | Error: `"Nested archives are not allowed."`. |
| Project Language (Archive) | Primary language must be JS or TS | Backend `validateArchiveLanguage` | HTTP 400: `"Unsupported project. CovAI only supports projects whose primary language is JavaScript or TypeScript..."`. |
| Duplicate Ingestion | SHA-256 checksum collision for same project | Backend `uploadProjectZip` | HTTP 409: `"Duplicate snapshot already exists"`. |
| GitHub URL Format | Starts with `https://github.com/` and length > 22 | Frontend regex & Backend controller | Button disabled in UI; Server returns 400: `"Invalid GitHub URL format."`. |
| GitHub Language Gating | Repository primary language must be JS/TS | Frontend `RepoItem` & Backend clone controller | Button disabled with label `"Not Supported"`; Server returns 400: `langCheck.reason`. |
| GitHub Private Auth | Requires valid OAuth token | Backend `GitHubRepositoryAccessService` | HTTP 401/403: `"GitHub authentication token is missing..."` or `"Access denied"`. |

### 7.2 Progress and Feedback States

1. **Local Archive Ingest:**
   - **Validation Phase:** Dropzone file card renders spinning `Loader2` icon with text `"Checking language & project structure..."`.
   - **Upload Phase:** Button enters loading state with spinning `Loader2` and text `"Extracting & Ingesting..."`.
   - **Completion:** Displays info toast: `""{projectName}" is being processed. Track progress in Job Queue."`.
2. **GitHub Ingestion:**
   - **Import Phase:** Button displays spinning `Loader2` with disabled interaction.
   - **Completion:** Displays info toast: `""{repoName}" is being imported. Track progress in Job Queue."`.
3. **Global Success Overlay:**
   - `showSuccessOverlay === true` mounts a centered modal overlay with emerald `CheckCircle2` icon, title `"Import Initialized!"`, and text `"Your project package has been queued. Redirecting to workspace..."`.
   - Delays 1,200ms before calling `onSuccess()` to allow visual confirmation.

---

## 8. Screenshot-to-Code Comparison

The following table compares each visual element in the supplied screenshot against the actual source code implementation:

| UI Element | Screenshot Observation | Source-Code Evidence | Status | Notes |
|---|---|---|---|---|
| Modal Title & Icon | Purple rounded box with `FolderGit2` icon; title `"Import Project"` | `ImportLayout.jsx:83-91`: `FolderGit2` (`size={16}`), `<h2>Import Project</h2>`. | `MATCH` | Identical styling, typography, and icon representation. |
| Hub Badge | Purple badge `"Hub"` next to title | `ImportLayout.jsx:93-95`: `<Badge variant="primary" size="sm">Hub</Badge>`. | `MATCH` | Exact visual match. |
| Esc Keyboard Hint | Monospace badge `"Esc"` | `ImportLayout.jsx:100-102`: `<span className="font-mono ...">Esc</span>`. | `MATCH` | Key listener registered in `useEffect` (`handleKeyDown`). |
| Close Button | Top-right "X" icon button | `ImportLayout.jsx:103-112`: `<button id="import-cancel-btn"><X size={16} /></button>`. | `MATCH` | Dispatches `onClose()`. |
| Left Panel Heading & Tag | `"LOCAL INGEST"` with `Zap` icon; `"Upload Codebase Archive"` | `ImportLayout.jsx:122-128`: `<Zap size={13} /> LOCAL INGEST`, `<h3>Upload Codebase Archive</h3>`. | `MATCH` | Exact match. |
| Left Panel Description | Text describing `.zip` or `.rar` compressed archive upload | `ImportLayout.jsx:130-140`: Mentions AST and cyclomatic complexity graphs. | `MATCH` | Exact text match. |
| Dropzone Visuals | Dashed border, cloud upload icon, `"Upload Project Archive"`, description | `LocalUpload.jsx:386-398`: `CloudUpload` (`size={24}`), exact title and description strings. | `MATCH` | Exact visual match. |
| Format & Size Badges | Badges: `.ZIP`, `.RAR`, text: `Max 200MB` | `LocalUpload.jsx:402-412`: `<Badge>.ZIP</Badge>`, `<Badge>.RAR</Badge>`, `Max 200MB`. | `MATCH` | Matches screenshot. Backend Multer limit verifies 200MB limit. |
| Browse Local Files Button | Gray button with hard drive icon: `"Browse Local Files"` | `LocalUpload.jsx:415-428`: `<Button variant="secondary" icon={HardDrive}>Browse Local Files</Button>`. | `MATCH` | Programmatically triggers native file input. |
| Hidden Input Accept Types | Native file picker filter | `LocalUpload.jsx:107`: `input.accept = ".zip,.rar,.tar.gz"`. | `PARTIAL MATCH` | Screenshot displays `.zip` and `.rar`; code accept string also allows `.tar.gz`, though backend Multer filter only accepts `.zip` and `.rar`. |
| Safe Upload Notice | Emerald shield icon + `"Safe upload: archives are scanned and cleaned of secrets locally."` | `ImportLayout.jsx:151-159`: `<Shield size={13} className="text-[var(--color-success)]" />`. | `MATCH` | Exact visual match. Backend enforces secret sanitization for `.env`, `.pem`, `.key`. |
| GitHub URL Section Header | Purple dot + `"IMPORT VIA GITHUB URL"` + `"Public or Private repos"` | `GitHubImport.jsx:103-113`: Exact label and font-mono subtitle. | `MATCH` | Exact visual match. |
| GitHub URL Input | Link icon, placeholder `"https://github.com/organization/repository"` | `GitHubImport.jsx:117-129`: `Link2` (`size={15}`), exact placeholder string. | `MATCH` | Exact match. |
| GitHub URL Import Button | Purple button with right arrow: `"Import"` | `GitHubImport.jsx:144-155`: `<Button variant="primary" icon={ArrowRight}>Import</Button>`. | `MATCH` | Disabled when URL is invalid. |
| Center Divider | Divider with text `"OR SELECT FROM ACCOUNT"` | `GitHubImport.jsx:167-173`: Centered font-mono divider. | `MATCH` | Exact visual match. |
| Connected Account Info | User icon, username `quy7373`, count `(20 repos)` | `RepoList.jsx:239-249`: Renders `User` icon, `{ownerName}`, `({count} repos)`. | `MATCH` | Screenshot shows live data (`quy7373`, 20 repos) loaded from GitHub API for that user account. |
| Repo Search Field | Search icon with placeholder `"Search repos..."` | `RepoList.jsx:252-268`: `Search` (`size={13}`), `placeholder="Search repos..."`. | `MATCH` | Filters repository array reactively. |
| Repo Card 1 (`test3`) | `test3`, TypeScript (Blue dot), `Updated 7/10/2026`, Button `"Import"` | `RepoList.jsx:39-183`: `RepoItem`, blue dot `#3178c6`, enabled secondary `"Import"` button. | `MATCH` | Rendered from live GitHub API data. |
| Repo Card 2 (`test2`) | `test2`, TypeScript (Blue dot), `Updated 3/10/2026`, Button `"Import"` | `RepoList.jsx:39-183`: `RepoItem`, blue dot `#3178c6`, enabled secondary `"Import"` button. | `MATCH` | Rendered from live GitHub API data. |
| Repo Card 3 (`test1`) | `test1`, TypeScript (Blue dot), `Updated 26/9/2026`, Button `"Import"` | `RepoList.jsx:39-183`: `RepoItem`, blue dot `#3178c6`, enabled secondary `"Import"` button. | `MATCH` | Rendered from live GitHub API data. |
| Repo Card 4 (`SmartCommer`) | `SmartCommer`, HTML (Red dot), badge `Unsupported`, Button `"Not Supported"` | `RepoList.jsx:144-180`: HTML dot `#e34c26`, red `Unsupported` badge, disabled ghost `"Not Supported"` button. | `MATCH` | Non-JS/TS repository gating verified in code. |
| Pagination Bar | `"Page 1 of 4"`, Left chevron (disabled), Right chevron (enabled) | `RepoList.jsx:305-335`: `Page {currentPage} of {totalPages}`, `ChevronLeft`, `ChevronRight`. | `MATCH` | 20 repos / 5 per page = 4 pages. Page 1 disables left arrow. |
| Modal Footer Help Link | Help circle icon + `"Need help? Check our workspace import guide."` | `ImportLayout.jsx:175-178`: Lucide `HelpCircle` (`size={13}`) and exact text. | `PARTIAL MATCH` | Visual text matches screenshot, but element is rendered as a static `<span>` without an `<a>` anchor tag or `href` link. |
| Modal Footer Cancel Button | Gray button `"Cancel"` | `ImportLayout.jsx:179-186`: `<Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>`. | `MATCH` | Closes modal without triggering any import. |

---

## 9. Findings and Limitations

### 9.1 Verified Implementation Strengths

1. **Multi-Layered Security Architecture:**
   - The local archive ingestion does not naively unzip files to disk. It runs an in-memory security scan (`scanArchiveBomb`) verifying compression ratio, file count (max 10,000), total uncompressed size (max 1GB), path traversal (`..`), symlinks, and blacklisted secret files (`.env`, `.pem`, `.key`).
2. **Language Compatibility Gating:**
   - Strict language enforcement is applied consistently across all channels:
     - Local Ingest: Pre-flight validation (`POST /api/projects/validate-archive`) inspects archive headers and rejects non-JS/TS projects before upload.
     - GitHub URL Import: Cloned repos are inspected via `detectLanguageFromDirectory`; non-JS/TS codebases are purged immediately from disk.
     - GitHub Account Selector: Repositories with primary languages other than JavaScript or TypeScript (such as HTML `SmartCommer` in the screenshot) are visually tagged with an `"Unsupported"` badge and have their import buttons disabled with `"Not Supported"`.
3. **Idempotency and Duplicate Protection:**
   - Uploaded archives have their SHA-256 hash computed before ingestion. Existing snapshots with identical checksums are rejected with HTTP 409 to prevent duplicate processing.
4. **Resilient GitHub Integration:**
   - Supports both unauthenticated public cloning and authenticated private cloning using decrypted user OAuth access tokens (`x-access-token`).
   - Automatically cleans up temporary directories if a clone operation fails or if language validation is rejected.

### 9.2 Identified Inconsistencies and Discrepancies

1. **Help Guide Text Is Non-Clickable:**
   - In `ImportLayout.jsx:175-178`, the text `"Need help? Check our workspace import guide."` is rendered inside a plain `<span>` element rather than an interactive `<a>` hyperlink. Clicking it does not open any external or internal documentation guide.
2. **Accept Attribute Mismatch:**
   - `LocalUpload.jsx:107` sets `input.accept = ".zip,.rar,.tar.gz"`. However, the UI labels only mention `.zip` and `.rar`, and the backend Multer file filter (`upload.middleware.js:39`) strictly requires `ext === ".zip" || ext === ".rar"`. Selecting a `.tar.gz` file will pass client selection but will be rejected with an error by the backend.
3. **Cloning History Preservation:**
   - While `GitHubCloneService` removes accidentally committed `node_modules`, it intentionally preserves the `.git` directory (`GitHubCloneService.js:86-88`). This preserves repository history, branches, and remotes, but increases local storage footprint.

---

## 10. Source References

The following table provides exact file paths, component names, function identifiers, and line ranges for all inspected logic:

| File Reference | Symbol / Function | Line Range | Description |
|---|---|---|---|
| `client/src/components/dashboard/import/ImportLayout.jsx` | `ImportLayout` | Lines 33–211 | Modal dialog portal, Esc listener, layout grid, footer. |
| `client/src/components/dashboard/import/LocalUpload.jsx` | `LocalUpload` | Lines 40–434 | Dropzone drag events, pre-flight validation, upload trigger. |
| `client/src/components/dashboard/import/GitHubImport.jsx` | `GitHubImport` | Lines 27–212 | GitHub URL validation, URL import handler, OAuth prompt. |
| `client/src/components/dashboard/import/RepoList.jsx` | `RepoList` | Lines 186–338 | GitHub repos querying, client search, 5-per-page pagination. |
| `client/src/components/dashboard/import/RepoList.jsx` | `RepoItem` | Lines 39–183 | Single repo row, language dot coloring, JS/TS gating. |
| `client/src/services/project.service.js` | API Client Functions | Lines 29–198 | Frontend HTTP fetch calls for projects, uploads, and GitHub. |
| `server/src/routes/project.route.js` | Router Configuration | Lines 16–43 | Route definitions for project creation, validation, upload. |
| `server/src/routes/github.route.js` | Router Configuration | Lines 10–20 | Route definitions for GitHub URL and repo clone endpoints. |
| `server/src/routes/auth.route.js` | Router Configuration | Lines 26–28 | Route definitions for GitHub OAuth callback and repo list. |
| `server/src/middlewares/upload.middleware.js` | `uploadSingleArchive` | Lines 26–59 | Multer config, 200MB limit, `.zip` and `.rar` filter. |
| `server/src/middlewares/upload.middleware.js` | `scanArchiveBomb` | Lines 63–192 | Secret sanitization (`.env`, `.pem`, `.key`), bomb protection. |
| `server/src/utils/languageDetector.js` | `detectLanguageFromPaths` | Lines 110–205 | Core path-based primary language analysis (JS/TS support). |
| `server/src/utils/languageDetector.js` | `validateArchiveLanguage` | Lines 259–299 | In-memory archive language validation without disk extraction. |
| `server/src/controllers/project.controller.js` | `validateArchive` | Lines 545–587 | Controller executing pre-flight archive language/bomb scan. |
| `server/src/controllers/github.controller.js` | `cloneGitHubRepositoryByUrl` | Lines 9–94 | Controller cloning public repo from URL, Jest/language check. |
| `server/src/controllers/github.controller.js` | `importGitHubRepository` | Lines 96–212 | Controller cloning private repo via user OAuth token. |
| `server/src/controllers/auth.controller.js` | `getGithubRepositories` | Lines 76–134 | Controller decrypting user token, querying GitHub repos API. |
| `server/src/services/githubClone.service.js` | `cloneRepository` | Lines 23–116 | Child process execution of `git clone`, commit SHA lookup. |
| `server/src/services/github.service.js` | `getGitHubToken` | Lines 11–26 | Database retrieval and AES decryption of user GitHub token. |
| `server/src/services/project.service.js` | `uploadProjectZip` | Lines 214–400 | Firebase upload, extraction, snapshot record creation. |

---

## 11. Final UI Specification Table

The following clean, standalone table is formatted for direct inclusion in the COVAI Capstone report:

| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `ModalOverlay` | Modal Backdrop | Visual overlay (`bg-black/60 backdrop-blur-xs`); responsive padding (`p-4 sm:p-6`); dismisses dialog on click. | Obscures dashboard background and dismisses the Import modal on outside click. |
| 2 | `ModalCardContainer` | Modal Container | Rounded surface container (`max-w-5xl max-h-[90vh] bg-[var(--color-surface)] border rounded-[var(--radius-xl)] shadow-xl`); stops click propagation. | Main modal shell housing the two-column ingestion layout. |
| 3 | `ModalHeader` | Modal Header Bar | Top bar (`h-14 px-6 border-b flex items-center justify-between`); contains brand icon, title, hub badge, Esc hint, and close icon. | Displays dialog identity and modal controls. |
| 4 | `HeaderBrandIcon` | Icon Container | Square container (`w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white flex items-center justify-center`); renders Lucide `FolderGit2`. | Visual branding indicating repository and project import. |
| 5 | `HeaderTitle` | Text Heading (`<h2>`) | Text: `"Import Project"`; styling: `font-bold text-sm tracking-tight text-[var(--color-text)]`. | Primary title of the modal dialog. |
| 6 | `HeaderHubBadge` | Badge | Text: `"Hub"`; `<Badge variant="primary" size="sm">`; purple background with white text. | Identifies dialog as the project management hub. |
| 7 | `HeaderEscHint` | Keyboard Hint Badge | Text: `"Esc"`; border badge (`text-[11px] font-mono text-[var(--color-text-muted)] border px-1.5 py-0.5`). | Informs user that pressing Escape closes the modal. |
| 8 | `HeaderCloseButton` | Icon Button | Icon button with Lucide `X` (`size={16}`); `title="Close"`; `id="import-cancel-btn"`. | Dismisses the modal dialog without importing. |
| 9 | `LocalIngestTag` | Category Label | Text: `"LOCAL INGEST"`; uppercase purple label with Lucide `Zap` (`size={13}`). | Identifies the left column as local codebase ingestion. |
| 10 | `LocalIngestHeading` | Text Heading (`<h3>`) | Text: `"Upload Codebase Archive"`; styling: `text-base font-bold text-[var(--color-text)] tracking-tight`. | Section heading for local archive upload. |
| 11 | `LocalIngestDescription` | Descriptive Text (`<p>`) | Text: `"Upload a compressed archive (.zip or .rar). AST and cyclomatic complexity graphs are synthesized automatically."`. | Explains supported file extensions and AST synthesis. |
| 12 | `DropzoneArea` | File Upload Area | Dashed dropzone (`border-2 border-dashed p-6 rounded-[var(--radius-lg)] min-h-[300px]`); reactive border states (`idle`, `over`, `dropped`). | Drag-and-drop landing area for compressed project archives. |
| 13 | `DropzoneIcon` | Icon Container | Rounded square (`w-12 h-12 bg-[var(--color-surface-secondary)] border text-[var(--color-primary)]`); renders Lucide `CloudUpload`. | Visual cue for codebase archive uploading. |
| 14 | `DropzoneTitle` | Text Heading (`<h3>`) | Text: `"Upload Project Archive"`; styling: `text-sm font-semibold text-[var(--color-text)] tracking-tight`. | Sub-heading inside dropzone. |
| 15 | `DropzoneSubtitle` | Descriptive Text (`<p>`) | Text: `"Drag and drop your codebase archive here to parse and synthesize tests"`; styling: `text-xs text-[var(--color-text-secondary)]`. | Actionable instruction for file drop. |
| 16 | `DropzoneZipBadge` | Badge | Text: `".ZIP"`; `<Badge variant="neutral" size="sm">`. | Indicates `.zip` archive support. |
| 17 | `DropzoneRarBadge` | Badge | Text: `".RAR"`; `<Badge variant="neutral" size="sm">`. | Indicates `.rar` archive support. |
| 18 | `DropzoneSizeLimit` | Text Label | Text: `"Max 200MB"`; styling: `text-[11px] font-mono text-[var(--color-text-muted)]`. | Displays maximum archive upload size (200MB). |
| 19 | `BrowseFilesButton` | Action Button | Text: `"Browse Local Files"`; `<Button variant="secondary" size="sm">`; renders Lucide `HardDrive`; `id="browse-files-btn"`. | Opens system file picker dialog. |
| 20 | `HiddenFileInput` | HTML File Input (Dynamic) | Programmatic `<input type="file" accept=".zip,.rar,.tar.gz">`; hidden from visual DOM. | Ingests selected file from native OS file browser. |
| 21 | `DroppedFileCard` | File Metadata Card | Container rendered when file is dropped; displays file icon, filename, size, archive type, and validation status. | Summarizes selected archive metadata. |
| 22 | `DroppedFileRemoveButton` | Icon Button | Icon button with Lucide `X` (`size={14}`); triggers `handleClear()`. | Clears selected file and resets dropzone to idle state. |
| 23 | `DroppedFileLanguageStatus` | Status Row / Badge | Displays `Loader2` during validation, `<Badge variant="success">` for detected language, or `<Badge variant="danger">Unsupported</Badge>`. | Real-time feedback on project language compatibility. |
| 24 | `DroppedFileErrorCard` | Alert Banner (Conditional) | Alert box (`bg-[var(--color-danger)]/10 text-[var(--color-danger)] p-3 text-xs`); renders Lucide `AlertCircle`. | Displays detailed language incompatibility or archive error. |
| 25 | `DroppedFileImportButton` | Submit Action Button | Label cycles: `"Import Project"`, `"Checking Language..."`, `"Extracting & Ingesting..."`, or `"Unsupported Project"`; `id="upload-import-btn"`. | Triggers project creation and binary upload. |
| 26 | `SafeUploadNotice` | Security Banner | Text: `"Safe upload: archives are scanned and cleaned of secrets locally."`; renders Lucide `Shield` in emerald green; `text-[11px]`. | Informs developer of local secret sanitization (`.env`, `.pem`, `.key`). |
| 27 | `GitHubUrlSectionHeading` | Section Heading (`<label>`) | Text: `"IMPORT VIA GITHUB URL"` with purple bullet point dot; uppercase font-semibold text; `htmlFor="github-url-input"`. | Section title for repository URL import. |
| 28 | `GitHubUrlVisibilityLabel` | Text Label | Text: `"Public or Private repos"`; styling: `text-[11px] font-mono text-[var(--color-text-muted)]`. | Informs users of public and private repo support. |
| 29 | `GitHubUrlLinkIcon` | Icon Container | Lucide `Link2` (`size={15}`) with `text-[var(--color-text-muted)]`. | Visual cue for repository web hyperlink. |
| 30 | `GitHubUrlInputField` | Text Input Field | Controlled input; `placeholder="https://github.com/organization/repository"`; `id="github-url-input"`. | Receives GitHub repository URL. |
| 31 | `GitHubUrlValidationBadge` | Status Indicator (Conditional) | Green `CheckCircle2` (`size={15}`) if URL valid; amber dot (`w-2 h-2 rounded-full bg-amber-400`) if incomplete. | Provides real-time URL validation feedback. |
| 32 | `GitHubUrlImportButton` | Submit Action Button | Text: `"Import"`; `<Button variant="primary" size="md">`; renders Lucide `ArrowRight`; `id="url-import-btn"`. | Triggers project creation and GitHub URL repository clone. |
| 33 | `DividerOrSelectFromAccount` | Section Divider | Centered divider text: `"OR SELECT FROM ACCOUNT"`; uppercase font-mono text flanked by horizontal divider lines. | Separates URL import from account repository browser. |
| 34 | `ConnectedAccountInfo` | User Badge Container | Displays `User` icon, connected username `{ownerName}`, and repository count `({count} repos)`. | Identifies authenticated GitHub user and repository volume. |
| 35 | `RepoSearchInput` | Search Input Field | Search input (`placeholder="Search repos..."`); renders Lucide `Search` (`size={13}`); `id="repo-search-input"`. | Filters repository list reactively on client side. |
| 36 | `RepoListScrollContainer` | Scrollable List Container | Vertical scroll container (`overflow-y-auto max-h-[280px]`); renders up to 5 repository cards. | Houses repository item cards. |
| 37 | `RepoItemCard` | Repository Card | Row card (`hover:bg-[var(--color-surface-secondary)] border rounded-[var(--radius-md)] p-3`); `id="repo-item-${id}"`. | Displays single repository metadata and actions. |
| 38 | `RepoItemIcon` | Icon Container | Lucide `FolderGit2` (public) or Lucide `Lock` in amber (private). | Indicates repository visibility type. |
| 39 | `RepoItemName` | Text (Repo Name) | Text: `{repo.name}`; font-semibold text; truncated on overflow. | Displays repository name. |
| 40 | `RepoItemPrivateBadge` | Badge (Conditional) | Text: `"Private"`; `<Badge variant="warning" size="sm">`; rendered if `repo.isPrivate === true`. | Tags private repositories. |
| 41 | `RepoItemLanguageDot` | Color Dot Indicator | Colored circle (`w-2 h-2 rounded-full`); color mapped via `getLangColor()` (e.g., `#3178c6` for TypeScript, `#e34c26` for HTML). | Visual programming language color indicator. |
| 42 | `RepoItemLanguageName` | Text (Language) | Text: `{repo.language}`; e.g., `"TypeScript"`, `"JavaScript"`, `"HTML"`. | Displays repository primary language. |
| 43 | `RepoItemUnsupportedBadge` | Status Badge (Conditional) | Text: `"Unsupported"`; red badge (`bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-[10px]`); rendered if non-JS/TS. | Highlights non-supported repository languages. |
| 44 | `RepoItemUpdatedDate` | Text (Date) | Text: `"Updated {date}"`; formatted locale date string. | Displays repository last updated date. |
| 45 | `RepoItemImportButton` | Action Button | Text: `"Import"` (enabled, secondary) or `"Not Supported"` (disabled, ghost); `id="repo-import-${id}"`. | Triggers repository clone or indicates incompatibility. |
| 46 | `PaginationPageInfo` | Text (Page Counter) | Text: `"Page {current} of {total}"`; styling: `text-[11px] font-mono text-[var(--color-text-muted)]`. | Displays current page and total page count (5 items/page). |
| 47 | `PaginationPrevButton` | Icon Button | Icon button with Lucide `ChevronLeft` (`size={14}`); disabled when `currentPage === 1`. | Navigates to previous page of repositories. |
| 48 | `PaginationNextButton` | Icon Button | Icon button with Lucide `ChevronRight` (`size={14}`); disabled when `currentPage === totalPages`. | Navigates to next page of repositories. |
| 49 | `OAuthConnectCard` | OAuth Fallback (Conditional) | Centered card shown when `hasGithub === false`; title `"Connect GitHub Account"`, description, and button `#connect-github-import-btn`. | Prompts unlinked users to authorize GitHub OAuth. |
| 50 | `ModalFooter` | Modal Footer Bar | Bottom bar (`h-11 px-6 border-t bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs text-[var(--color-text-muted)]`). | Bottom bar housing help text and cancel button. |
| 51 | `FooterHelpText` | Static Text | Text: `"Need help? Check our workspace import guide."`; renders Lucide `HelpCircle` (`size={13}`). | Contextual help text for users. |
| 52 | `FooterCancelButton` | Action Button | Text: `"Cancel"`; `<Button variant="secondary" size="sm">`; click triggers `onClose()`. | Dismisses modal without performing any action. |
| 53 | `SuccessOverlay` | Status Overlay (Conditional) | Modal overlay (`bg-black/60 backdrop-blur-xs`); renders emerald `CheckCircle2` (`size={24}`), heading `"Import Initialized!"`, description. | Post-import confirmation overlay delaying 1.2s before redirect. |
