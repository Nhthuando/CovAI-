# COVAI Settings Module — Implementation Analysis

## 1. Introduction

### 1.1 Objective and Purpose
This document delivers an exhaustive, source-verified technical report on the **Settings module** within the **COVAI Studio** automated testing and quality platform. Prepared as part of the official Capstone technical documentation for the COVAI system, this report details the architectural layout, frontend component hierarchy, local state management, persistent storage models, REST API endpoints, security mechanisms, notification services, and billing representations across the five core settings sections: **Profile**, **Appearance**, **Security**, **Notifications**, and **Billing**.

The primary objective of the Settings module is to provide software engineers, QA practitioners, and administrators with an integrated configuration suite to manage personal identities, customize developer workspace aesthetics and editor typography, review account security, configure notification channels, and inspect cloud compute quotas.

### 1.2 Scope of Analysis
The scope of this investigation includes:
1. **Workspace Layout and Navigation Architecture:** Component composition, Activity Bar integration, vertical navigation sidebar (`SettingsSidebar.jsx`), mobile responsive tabs, and modal logout flows.
2. **Profile Management:** Avatar image ingestion, base64 data encoding, client/backend image size constraints, email field locking, verified status indicators, bio length boundaries, and database persistence via Prisma ORM.
3. **Appearance and Editor Customization:** Dual-mode theme orchestration (`dark`, `light`, `system`), media query synchronization (`prefers-color-scheme`), Monaco editor options, local storage persistence, and verification of editor setting consumption.
4. **Security and Authentication Settings:** Frontend password validation rules, mock API simulation behaviors, Two-Factor Authentication (2FA) toggle state, static mock active sessions, and account deletion restriction boundaries.
5. **Notification and Alert Subsystems:** Preferences state management, simulated alert triggers (Test Failure, Weekly Digest, Coverage Drop < 80%, Job Status, Audio Chimes), real-time WebSocket dispatch via Socket.IO, database-backed notification history, and read status lifecycles.
6. **Subscription and Quota Metrics:** Presentation of subscription tiers (Starter Free, Pro Developer, Team & Enterprise), mock invoice registries, hardcoded compute quotas (AI requests and runner minutes), and Stripe Customer Portal simulation.
7. **Traceability and Defect Discovery:** Complete tracing of all 17 user workflows, cataloging of verified bugs, structural limitations, and UI/backend discrepancies.

### 1.3 Methodology and Verification Standards
In strict accordance with the Capstone verification guidelines:
- **Code-Backed Verification:** Every architectural claim, data flow, event handler, and UI behavior documented herein is verified directly against active source files in the repository.
- **Privacy and Data Anonymization:** In compliance with privacy requirements, all personal user data visible in system screenshots (e.g., account usernames, personal email addresses, and geographic IP addresses) have been replaced with generic placeholders (`johndoe`, `developer@example.com`, `192.168.1.100`) throughout this report.
- **Classification Taxonomy:** Implementation statuses are categorized strictly using the four approved levels:
  - `IMPLEMENTED`: Verified in active source code with fully functional frontend-to-backend operations.
  - `PARTIALLY IMPLEMENTED`: Code exists but exhibits limitations, mock fallbacks, or incomplete persistence.
  - `NOT IMPLEMENTED`: Feature or concept referenced in UI/documentation but entirely absent from active codebase.
  - `UNVERIFIED`: Behavior cannot be definitively confirmed through static code inspection.
- **Integrity Guarantee:** No application source code, database migrations, configuration files, or analysis artifacts were modified during this investigation.

---

## 2. Settings Module Overview

### 2.1 Role in COVAI Studio
Within COVAI Studio (`client/src/components/dashboard/Layout.jsx`), the Settings module is accessible via the primary **Activity Bar** (`client/src/components/dashboard/ActivityBar.jsx:26`) through the `Settings` / `Cog` icon (`id: "settings"`). When triggered, the layout mounts `SettingsSidebar.jsx` inside the primary left sidebar slot (`Layout.jsx:874-881`) and displays the active configuration panel within the central viewport (`Layout.jsx:930-943`).

```
+----------------------------------------------------------------------------------------------------------------------------------+
| Top Bar: CoVAI Studio / {project.name}                                                              [Projects] [Export] (Bell)   |
+----+------------------------------+------------------------------------------------------------------------+---------------------+
| A  | PREFERENCES & SETTINGS       | ACTIVE SETTINGS VIEWPORT (Profile / Appearance / Security / ...)       | COV AI Agent Panel  |
| c  |                              |                                                                        | (Collapsible)       |
| t  | [User] Profile               | [Heading: User Profile / Appearance / Security / Notifications / ...]  |                     |
| i  |        Personal info & avatar| [Subtitle: Description of active settings section ...]                 | What AI knows | Hist|
| v  |                              |                                                                        |                     |
| i  | [Palette] Appearance         | +--------------------------------------------------------------------+ | Quick Capabilities  |
| t  |        Themes & editor font  | | Card Section 1 (e.g. Profile Photo / Workspace Theme / Password)   | | - Find edge cases   |
| y  |                              | +--------------------------------------------------------------------+ | - Generate tests    |
|    | [Shield] Security            |                                                                        | - Explain gaps      |
| B  |        Password & 2FA        | +--------------------------------------------------------------------+ |                     |
| a  |                              | | Card Section 2 (e.g. Personal Info / Editor Prefs / Sessions)      | | Chat Input:       |
| r  | [Bell] Notifications         | +--------------------------------------------------------------------+ | Ask COV or type @   |
|    |        Alerts & preferences  |                                                                        |                     |
|    |                              | [ Footer Actions: Cancel / Save Changes / Update ]                     |                     |
|    | [CreditCard] Billing         |                                                                        |                     |
|    |        Plans & AI quotas     |                                                                        |                     |
|    +------------------------------+                                                                        |                     |
|    | [->] Log Out                 |                                                                        |                     |
+----+------------------------------+------------------------------------------------------------------------+---------------------+
| Bottom Bar: [branch: main] [Engine Ready: test2]                                                           | [Target: 80%+] [UTF-8]|
+----------------------------------------------------------------------------------------------------------------------------------+
```

### 2.2 Navigation Architecture and Sub-Modules
The module is partitioned into five distinct configuration views managed through active tab state:
1. **Profile (`activeSetting === "profile"`):** Implemented in `UserProfile.jsx` (299 lines). Manages public developer identity, full name, locked email, job title, bio, and avatar upload.
2. **Appearance (`activeSetting === "appearance"`):** Implemented in `Appearance.jsx` (308 lines). Manages dark/light/system theme toggling and Monaco editor options (font family, font size, minimap, line numbers, word wrap).
3. **Security (`activeSetting === "security"`):** Implemented in `Security.jsx` (389 lines). Manages password updates with strength estimation, 2FA toggle simulation, mock active session viewing, and account deletion warnings.
4. **Notifications (`activeSetting === "notifications"`):** Implemented in `NotificationsSettings.jsx` (442 lines). Dual-tab interface containing local notification preference checkboxes and a database-backed recent history audit list.
5. **Billing (`activeSetting === "billing"`):** Implemented in `Billing.jsx` (323 lines). Renders current plan metadata, compute quota gauges (AI requests, runner minutes), pricing tier cards, and mock invoice PDF download links.

---

## 3. Settings Navigation and Shared Layout

### 3.1 Sidebar Navigation and Layout Integration
In `client/src/components/dashboard/Layout.jsx:874-881`, when `activeActivity === "settings"`, the IDE mounts `SettingsSidebar.jsx`. The sidebar is rendered with two presentation variants:
- **Desktop Sidebar (`variant === "sidebar"`):** Renders a vertical menu (`w-full flex flex-col justify-between select-none`) displaying section titles, icon badges, and secondary subtitles (`SettingsSidebar.jsx:104-168`).
- **Mobile Tab Bar (`variant === "tabs"`):** When `isMobile` is detected, `Layout.jsx:931-936` renders an overflow-x scrolling horizontal tab bar pinned to the top of the viewport (`SettingsSidebar.jsx:58-100`).

### 3.2 State Management and Unsaved Changes Handling
- **Section Selection:** Managed by local component state `activeSetting` in `Layout.jsx:136` (default: `"profile"`). Clicking any option in `SettingsSidebar.jsx:118` executes `onSelectSetting(option.id)`, immediately rendering the corresponding child component.
- **Unsaved Changes Finding:** Switching between settings sections does **not** evaluate form dirty state. Any unsaved input typed into Profile, Password, or Notification checkboxes is discarded when switching tabs because child components unmount completely without triggering confirmation prompts.

### 3.3 Log Out Action and Dialog Lifecycle
Located at the bottom of `SettingsSidebar.jsx:146-167`, the `Log Out` button is styled with danger tones (`bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/25`).
1. Clicking `Log Out` opens a modal dialog managed by `ConfirmDialog.jsx` (`showLogoutConfirm = true`).
2. The dialog prompts: *"Are you sure you want to sign out? You will be redirected to the home landing page."*
3. Confirming executes `handleLogout` (`SettingsSidebar.jsx:52-56`):
   ```javascript
   const handleLogout = () => {
     setShowLogoutConfirm(false);
     logout();
     navigate("/", { replace: true });
   };
   ```
4. `logout()` from `useAuth()` purges authentication tokens from `localStorage` (`token`, `user`, `userName`, `userEmail`) and resets the global authentication context, while `navigate("/", { replace: true })` redirects to the public landing route.

---

## 4. Profile Settings

### 4.1 Profile Photo
The Profile Photo card (`UserProfile.jsx:101-187`) manages user avatar visualization, upload, and deletion.

```
+----------------------------------------------------------------------------------------------------+
|  +------------+   Profile Photo                                                                    |
|  |     Q      |   PNG, JPG, or GIF up to 2MB. Recommended 256x256px.                               |
|  |  (Avatar)  |   [ [Upload] Change Avatar ]  [ [Trash] Remove ]                                   |
|  +------------+                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

#### Code Verification Findings:
1. **Avatar Ingestion Mechanism:** Ingestion uses a hidden file input `<input type="file" id="avatar-upload" className="hidden" accept="image/*">` triggered programmatically by the `Change Avatar` button (`UserProfile.jsx:135-154`).
2. **Encoding Format:** Selected files are read client-side using `FileReader.readAsDataURL(file)`, which converts the binary image into a Base64-encoded Data URI (`data:image/png;base64,...`).
3. **Client-Side Validation Discrepancy:**
   - **File Size Limit:** While the card copy states *"PNG, JPG, or GIF up to 2MB"*, the `onChange` handler in `UserProfile.jsx:140-153` contains **no file size validation check** (`file.size <= 2 * 1024 * 1024`). Files exceeding 2 MB are read into memory and encoded into base64 without client warning.
   - **Dimension Limit:** There is **no client-side image dimension validation** or cropping mechanism for the recommended `256x256px`.
   - **File Formats:** The file picker uses `accept="image/*"`, permitting any image format (SVG, WebP, BMP), rather than restricting strictly to PNG, JPG, and GIF.
4. **Backend Validation and Persistence Discrepancy:**
   - The profile update is dispatched via `PATCH /api/users/me` (`server/src/routes/user.route.js:8`).
   - The backend controller (`server/src/controllers/user.controller.js:20-56`) validates the payload using Zod schema `meValid` (`server/src/validators/user.validation.js:3-25`):
     ```javascript
     export const meValid = z.object({
       name: z.string().min(1).max(100).optional().or(z.literal("")),
       avatarUrl: z.string().url("Must be a valid URL!").optional().or(z.literal("")),
       jobTitle: z.string().max(100).optional().or(z.literal("")),
       bio: z.string().max(500).optional().or(z.literal("")),
     });
     ```
   > [!WARNING]
   > **Critical Architecture Discrepancy:** Zod's `z.string().url()` validates RFC 3986 URLs (expecting schemes like `http://` or `https://`). When the client submits a Base64 Data URI (`data:image/png;base64,...`), standard Zod URL validation rejects the payload with HTTP 400 (`Must be a valid URL!`), causing profile saves with newly uploaded avatars to fail unless an external HTTP image link is supplied or Zod is modified to accept data URIs.
5. **Fallback Initials:** If `avatarUrl` is empty, `UserProfile.jsx:76-84` derives a 2-character uppercase monogram from `profile.name` (`getInitials`), rendering it inside a rounded container (`w-[84px] h-[84px]`).
6. **Avatar Lightbox:** Clicking an existing avatar triggers an expanded modal preview (`isAvatarExpanded = true`, `UserProfile.jsx:122-133`).

### 4.2 Personal Information
The Personal Information card (`UserProfile.jsx:190-295`) provides inputs for user identity details.

#### Field Behavior Verification:
1. **Full Name:**
   - Editable text input bound to `profile.name`.
   - Backend validation: `z.string().min(1).max(100)`. Stored in PostgreSQL `User.name`.
2. **Email Address & Verification Status:**
   - Rendered with `readOnly` attribute, muted background (`bg-[var(--color-surface-secondary)]`), and a trailing `Lock` icon (`UserProfile.jsx:224-234`).
   - The input is unmodifiable. The backend update service (`user.service.js:34-47`) explicitly ignores email updates.
   - **Verification Badge Fact:** The green badge `<CheckCircle2 size={11} /> Verified` is **hardcoded in the JSX** (`UserProfile.jsx:218-221`). The database schema (`server/prisma/schema.prisma:10-34`) contains no `emailVerified` boolean; verification status is permanently displayed as verified regardless of user state.
3. **Job Title / Role:**
   - Editable text input bound to `profile.jobTitle`. Placeholder: `"e.g. Senior QA Engineer / Full Stack Developer"`.
   - Backend validation: `z.string().max(100)`. Stored in PostgreSQL `User.jobTitle`.
4. **Bio & Character Counter:**
   - `<textarea>` bound to `profile.bio` with HTML attribute `maxLength={500}` (`UserProfile.jsx:265-272`).
   - Counter dynamically renders `{profile?.bio?.length || 0} / 500`.
   - Backend validation: `z.string().max(500)`. Stored in PostgreSQL `User.bio`.
5. **Action Controls:**
   - **Cancel:** Invokes `handleCancel` (`UserProfile.jsx:65-74`), resetting `profile` to `initialProfile` captured on mount and displaying an info toast: *"Changes Reverted"*.
   - **Save Changes:** Invokes `handleSave` (`UserProfile.jsx:43-63`), sending `PATCH /api/users/me`. On success, updates `initialProfile` and displays a success toast. On error, displays an error toast.

#### Personal Information Specification Table
| Field / Control | Type | Editable | Validation | Persistence | Status |
|---|---|---|---|---|---|
| **Profile Photo** | Image Container | No (Display only) | 2-char monogram fallback | Database (`User.avatarUrl`) | `IMPLEMENTED` |
| **Change Avatar** | Hidden File Input | Yes (File picker) | `accept="image/*"`, No client size limit | Local state $\rightarrow$ Base64 | `PARTIALLY IMPLEMENTED` |
| **Remove Avatar** | Action Button | Yes (Clear) | Appears only when `avatarUrl` exists | Sets `avatarUrl = ""` | `IMPLEMENTED` |
| **Full Name** | Text Input | Yes | Zod: 1–100 characters | Database (`User.name`) | `IMPLEMENTED` |
| **Email Address** | Text Input | No (`readOnly`) | Locked cursor, uneditable | Database (`User.email`) | `IMPLEMENTED` |
| **Verified Status** | Status Indicator | No | Hardcoded visual element | None (Static UI) | `PARTIALLY IMPLEMENTED` (Mock) |
| **Job Title / Role** | Text Input | Yes | Zod: Max 100 characters | Database (`User.jobTitle`)| `IMPLEMENTED` |
| **Bio** | Textarea | Yes | `maxLength={500}`, Zod max 500 | Database (`User.bio`) | `IMPLEMENTED` |
| **Bio Counter** | Numeric Label | No | Displays `{length} / 500` | Pure client DOM | `IMPLEMENTED` |
| **Cancel Button** | Button | Yes | Restores `initialProfile` snapshot | None | `IMPLEMENTED` |
| **Save Changes** | Submit Button | Yes | Disabled while saving (`isSaving`) | `PATCH /api/users/me` | `IMPLEMENTED` |

---

## 5. Appearance and Editor Settings

### 5.1 Workspace Theme
Workspace theme selection (`Appearance.jsx:101-167`) allows developers to customize the visual palette of COVAI Studio.

#### Options and Visual Tokens:
1. **Dark Environment (`id: "dark"`):** Developer dark mode. Visual tokens: Background `#0b0f14`, Sidebar `#11161d`, Accent `#8b7cfd`, Border `#29313d`.
2. **Light Clean (`id: "light"`):** Clean light workspace. Visual tokens: Background `#ffffff`, Sidebar `#f8fafc`, Accent `#6d5dfb`, Border `#e2e8f0`.
3. **System Default (`id: "system"`):** Automatically synchronizes with the host operating system preference using CSS media query `(prefers-color-scheme: dark)`.

#### Theme Application and Persistence:
- **Immediate Preview:** Selecting a theme card triggers `handleSelectTheme` (`Appearance.jsx:63-66`), calling `setTheme(themeId)` in `ThemeContext.jsx:25-28`. The theme applies to the entire DOM **immediately** without waiting for the user to click Save.
- **DOM Mutation:** `ThemeContext.jsx:30-57` sets `data-theme` attribute on `document.documentElement` (`root.setAttribute("data-theme", current)`) and toggles the CSS class `dark` on `document.documentElement.classList`.
- **System Preference Listening:** When set to `"system"`, `ThemeContext.jsx:51-56` registers a listener on `window.matchMedia("(prefers-color-scheme: dark)")` to update theme tokens dynamically when the OS dark/light mode toggles.
- **Persistence Mechanism:** Theme state is persisted client-side in `localStorage` under keys `covai_theme` and `ide_theme` (`Appearance.jsx:70-71`). It is not stored in the backend database.

### 5.2 Code Editor Preferences
The Code Editor Preferences card (`Appearance.jsx:170-303`) presents typography and layout toggles intended for the Monaco Editor.

#### Preferences Specifications:
- **Font Family:** `<select>` dropdown with 4 options: `"JetBrains Mono"` (Recommended default), `"Fira Code"`, `"Menlo"`, and `"Consolas"`.
- **Font Size:** 5 radio-style button pills: `"12px"`, `"13px"` (default), `"14px"`, `"15px"`, and `"16px"`.
- **Code Minimap:** Checkbox controlling whether miniature code outlines appear on the right editor gutter.
- **Show Line Numbers:** Checkbox controlling whether line numbers render alongside active code.
- **Word Wrap:** Checkbox controlling horizontal line wrapping vs. horizontal scrolling.
- **Save Behavior:** Clicking `Save Preferences` writes all preferences into browser `localStorage` (`Appearance.jsx:72-76`):
  ```javascript
  localStorage.setItem("editor_font_size", fontSize);
  localStorage.setItem("editor_font_family", fontFamily);
  localStorage.setItem("editor_minimap", showMinimap);
  localStorage.setItem("editor_line_numbers", lineNumbers);
  localStorage.setItem("editor_word_wrap", wordWrap);
  ```

#### Critical Editor Disconnect Finding:
> [!WARNING]
> **Major Architectural Discrepancy:** Inspection of the primary editor implementation in `client/src/components/dashboard/Editor.jsx` reveals that **the Monaco Editor does not consume these saved preferences**:
> 1. `Editor.jsx:605-606` initializes its own local state: `const [wordWrap, setWordWrap] = useState(true); const [showMinimap, setShowMinimap] = useState(false);` without reading `localStorage`.
> 2. `Editor.jsx:1370-1371` hardcodes Monaco font options: `fontSize: 13.5, fontFamily: "var(--font-mono), monospace"`, completely ignoring `editor_font_size` and `editor_font_family`.
> 3. Line numbers are always rendered by default Monaco configuration, ignoring `editor_line_numbers`.
> 
> Therefore, while the settings interface successfully saves preferences into `localStorage`, the active code editor fails to reflect these preferences.

#### Editor Preferences Specification Table
| Preference | Available Values | Actual Effect in UI | Save Behavior | Persistence | Status |
|---|---|---|---|---|---|
| **Workspace Theme** | `dark`, `light`, `system` | Toggles DOM root `data-theme` & class | Applied immediately & on save | `localStorage.covai_theme` | `IMPLEMENTED` |
| **Font Family** | JetBrains Mono, Fira Code, Menlo, Consolas | Changes select box | Saved to localStorage | `localStorage.editor_font_family` | `PARTIALLY IMPLEMENTED` (Ignored by Editor) |
| **Font Size** | `12px`, `13px`, `14px`, `15px`, `16px` | Toggles active button pill | Saved to localStorage | `localStorage.editor_font_size` | `PARTIALLY IMPLEMENTED` (Ignored by Editor) |
| **Code Minimap** | Checked (`true`) / Unchecked (`false`)| Toggles checkbox | Saved to localStorage | `localStorage.editor_minimap` | `PARTIALLY IMPLEMENTED` (Ignored by Editor) |
| **Show Line Numbers**| Checked (`true`) / Unchecked (`false`)| Toggles checkbox | Saved to localStorage | `localStorage.editor_line_numbers` | `PARTIALLY IMPLEMENTED` (Ignored by Editor) |
| **Word Wrap** | Checked (`true`) / Unchecked (`false`)| Toggles checkbox | Saved to localStorage | `localStorage.editor_word_wrap` | `PARTIALLY IMPLEMENTED` (Ignored by Editor) |

---

## 6. Security Settings

### 6.1 Change Password
The Change Password section (`Security.jsx:128-267`) provides fields to update account credentials.

#### Field and Validation Specifications:
1. **Inputs:**
   - `Current Password`: Text/password input with visibility toggle.
   - `New Password`: Text/password input with visibility toggle and strength gauge.
   - `Confirm New Password`: Text/password input with visibility toggle.
2. **Password Strength Meter:** Evaluated dynamically in `Security.jsx:29-37` on a 0–100 scale (+25 for length $\ge 8$, +25 for uppercase, +25 for numbers, +25 for special characters), rendering color-coded progress bars (Weak, Fair, Good, Strong).
3. **Client-Side Validation Rules:**
   - Current password required (`if (!pwForm.currentPassword)`).
   - New password length $\ge 8$ (`if (pwForm.newPassword.length < 8)`).
   - Confirmation match (`if (pwForm.newPassword !== pwForm.confirmPassword)`).
4. **Mock API Simulation Finding:**
   ```javascript
   // Security.jsx:84-98
   setIsSavingPw(true);
   // Simulate API call
   setTimeout(() => {
     setIsSavingPw(false);
     setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
     showToast({
       type: "success",
       title: "Password Updated",
       message: "Your password has been changed successfully.",
     });
   }, 800);
   ```
   > [!IMPORTANT]
   > **Verification Fact:** Clicking `Update Password` does **not** call any backend endpoint. The handler simulates network latency via an 800ms `setTimeout`, clears the form, and displays a success toast. The backend route table (`server/src/routes/auth.route.js`) contains no `/change-password` endpoint.

### 6.2 Two-Factor Authentication (2FA)
The Two-Factor Authentication card (`Security.jsx:270-316`) displays a status badge and configuration button.

#### Verification Findings:
- **Status Display:** Displays `Disabled` (or `Enabled` if toggled) in a badge pill.
- **Mock Toggle Implementation:** Clicking `Set Up 2FA` executes `handleToggle2FA` (`Security.jsx:101-111`), which inverts local component state `twoFactorEnabled = !twoFactorEnabled` and triggers a toast message.
- **Missing Infrastructure:** There is no QR code generator, TOTP secret negotiation, authenticator verification input, recovery code storage, or backend persistence. The feature is a visual prototype.

### 6.3 Active Sessions
The Active Sessions card (`Security.jsx:319-353`) displays connected devices and locations.

#### Verification Findings:
- **Hardcoded Mock Data:** The section displays a single hardcoded session card (`Security.jsx:329-352`):
  - Device: `Windows PC · Chrome Browser`
  - Badge: `Current Session`
  - IP Address & Location: `IP: 118.69.182.10 · Ho Chi Minh City, Vietnam`
  - Status: `Active now` with animated green dot indicator.
- **Absence of Session Management:** No session retrieval API exists, no device revocation controls are present, and JWT tokens remain stateless on the backend.

### 6.4 Delete Account
The Delete Account danger zone card (`Security.jsx:356-384`) presents account deletion functionality.

#### Verification Findings:
- **Action Restriction:** Clicking `Delete Account` executes:
  ```javascript
  onClick={() => {
    showToast({
      type: "warning",
      title: "Action Restricted",
      message: "Please contact support@testcovai.com to request account deletion.",
    });
  }}
  ```
- **No Direct Deletion:** There is no automated account deletion handler, confirmation modal, or backend deletion endpoint. Account deletion is restricted to manual support requests.

---

## 7. Notifications and Alerts

### 7.1 Notification Preferences Tab
Managed by `NotificationsSettings.jsx:155-344`, this tab allows users to configure alert channels.

```
+----------------------------------------------------------------------------------------------------+
|  Email Alerts                                                                                      |
|  [x] Test Execution Failures - Send email whenever a test run fails on a monitored snapshot       |
|  [ ] Weekly Summary Digest   - Receive a weekly report on project coverage gains and AI tests      |
|----------------------------------------------------------------------------------------------------|
|  In-App Notification Triggers                                                                      |
|  [x] AI Test Generation Ready - Notify when Gemini AI finishes generating skeleton or full suites   |
|  [x] Coverage Drop Alert      - Trigger alert if statement or branch coverage decreases below 80%  |
|  [x] Job Queue Status Updates - Notify on completion or cancellation of background worker jobs     |
|----------------------------------------------------------------------------------------------------|
|  Audio & Feedback                                                                                  |
|  [x] Play Notification Chimes - Play an auditory cue when background long-running tasks terminate  |
|----------------------------------------------------------------------------------------------------|
|                                                                          [ Save Preferences ]      |
+----------------------------------------------------------------------------------------------------+
```

#### Settings Details and Backend Verification:
1. **Email Alerts:**
   - **Test Execution Failures:** Checkbox exists, but the backend email utility (`server/src/utils/sendEmail.js`) is only referenced by `forgotPassword.controller.js`. It is **not wired** to test failure events in `runTestsJob.service.js`.
   - **Weekly Summary Digest:** Checkbox exists, but **no scheduled cron service** or digest compilation worker exists in the backend.
2. **In-App Notification Triggers:**
   - **AI Test Generation Ready:** Supported on backend via `NotificationTypeSchema` (`'AI_READY'`). Fired when Gemini jobs conclude.
   - **Coverage Drop Alert (< 80%):** Not implemented on backend; `NotificationTypeSchema` lacks a coverage drop enum.
   - **Job Queue Status Updates:** Supported on backend via `'JOB_FINISHED'`. Fired upon BullMQ job success or failure.
3. **Audio & Feedback (Play Notification Chimes):**
   - Checkbox exists in local state, but no `Audio()` instance or chime audio asset is triggered upon job completion in the frontend.
4. **Preferences Persistence Finding:**
   ```javascript
   // NotificationsSettings.jsx:99-105
   const handleSavePreferences = () => {
     showToast({
       type: "success",
       title: "Preferences Saved",
       message: "Your notification settings have been updated.",
     });
   };
   ```
   > [!IMPORTANT]
   > **Verification Fact:** Clicking `Save Preferences` displays a success toast but does **not save preferences to localStorage or a database endpoint**. The state is stored in React memory (`useState`) and resets upon browser reload.

### 7.2 Recent History Tab
Managed by `NotificationsSettings.jsx:346-438`, this tab renders an active audit trail of user notifications.

#### Functional Verification:
- **Backend Service:** Calls `notificationService.getNotifications(pageNum, LIMIT)` (`client/src/services/notification.service.js:47-86`) hitting `GET /api/notifications`.
- **Database Model:** Data is loaded from PostgreSQL table `Notification` (`schema.prisma:186-200`) filtering by `userId = req.user.id`.
- **Read State Management:** Unread notifications feature highlighted backgrounds (`bg-[var(--color-primary-light)]/40`). Clicking an unread item calls `PATCH /api/notifications/:id/read`. Clicking `Mark all as read` calls `PATCH /api/notifications/read-all`.
- **Pagination:** Supports cursor pagination via a `Load more` button when `hasMore === true`.
- **Badge Count:** The `Recent History` tab header displays an unread count pill (e.g. `4`) derived from `unreadCount` (`GET /api/notifications/unread-count`).

#### Notification Specification Table
| Notification Setting | Category | Trigger / Condition | Delivery Mechanism | Persistence | Status |
|---|---|---|---|---|---|
| **Test Execution Failures** | Email Alert | Test run failure on snapshot | `sendEmail.js` (Not wired) | React state only | `PARTIALLY IMPLEMENTED` (UI only) |
| **Weekly Summary Digest** | Email Alert | Weekly coverage/test gain report | None | React state only | `NOT IMPLEMENTED` |
| **AI Test Generation Ready** | In-App Alert | Gemini test job completion | Socket.IO + DB insert | React state only | `IMPLEMENTED` (Backend event exists) |
| **Coverage Drop Alert (<80%)**| In-App Alert | Coverage falls below 80% | None | React state only | `NOT IMPLEMENTED` |
| **Job Queue Status Updates** | In-App Alert | BullMQ worker complete/cancel | Socket.IO + DB insert | React state only | `IMPLEMENTED` (Backend event exists) |
| **Play Notification Chimes** | Audio | Long-running task termination | None (No audio playback) | React state only | `NOT IMPLEMENTED` |
| **Notification History List** | Audit Log | User notifications fetch | `GET /api/notifications` | PostgreSQL (`Notification`)| `IMPLEMENTED` |
| **Mark As Read (Single)** | Action | User clicks unread notification | `PATCH /api/notifications/:id/read` | Database (`readAt` timestamp)| `IMPLEMENTED` |
| **Mark All As Read** | Action | User clicks "Mark all as read" | `PATCH /api/notifications/read-all`| Database (`readAt` timestamps)| `IMPLEMENTED` |

---

## 8. Subscription and Billing

### 8.1 Current Plan
The Current Plan header card (`Billing.jsx:109-143`) presents the user's active billing status.

```
+----------------------------------------------------------------------------------------------------+
|  [CreditCard] Current Plan: Pro Developer  [Active]                    [ Manage Payment ]          |
|               $19/month · Renews on October 20, 2026                                               |
|----------------------------------------------------------------------------------------------------|
|  [Zap] AI Test Quota           64%    |   [Zap] Test Runner Minutes         34%                    |
|  [==============     ]                |   [=======              ]                                  |
|  642 / 1,000 requests used            |   68 / 200 minutes used                                    |
+----------------------------------------------------------------------------------------------------+
```

#### Verification Findings:
- **Plan Representation:** Defaults to local state `currentPlan = "pro"` (`Billing.jsx:8`).
- **Hardcoded Metadata:** The renewal string (`"$19/month · Renews on October 20, 2026"`) and status badge (`Active`) are hardcoded text literals.
- **Manage Payment Action:** Clicking `Manage Payment` triggers an informational toast: *"Redirecting to Stripe Customer Portal..."* (`Billing.jsx:133-138`). There is no actual Stripe API call or URL redirection.

### 8.2 Usage Quotas
The quota gauges (`Billing.jsx:145-190`) display progress bars for compute consumption.

#### Verification Findings:
- **AI Test Quota:** Progress bar displays hardcoded `64%` and text `642 / 1,000 requests used`. (Note: while `model User` has fields `aiUsageCount` and `aiTokenUsage`, `Billing.jsx` does not bind to them).
- **Test Runner Minutes:** Progress bar displays hardcoded `34%` (or `24%` in screenshot) and text `68 / 200 minutes used`.
- Quotas are static visual representations and do not reflect real-time database counts.

### 8.3 Available Plans
The Available Plans section (`Billing.jsx:193-264`) renders three tiered subscription cards:

1. **Starter Free ($0 / forever):** 100 AI requests/month, 3 active projects, basic unit test generation, community support. Action button: `Switch to Starter Free`.
2. **Pro Developer ($19 / per month):** 1,000 AI requests/month, unlimited projects, skeleton + full test generation, logic & CFG complexity graph, fast queue priority, email support. Marked with a `POPULAR` badge. Action button: `Current Plan` (disabled).
3. **Team & Enterprise ($49 / per month):** Unlimited AI generation, dedicated runner instances, custom test frameworks, SSO & 2FA compliance, 24/7 dedicated support. Action button: `Switch to Team & Enterprise`.

#### Plan Switching Verification:
Clicking any plan button executes `handleSelectPlan(planId)` (`Billing.jsx:83-91`):
```javascript
const handleSelectPlan = (planId) => {
  if (planId === currentPlan) return;
  setCurrentPlan(planId);
  showToast({
    type: "success",
    title: "Plan Changed",
    message: `You have selected the ${plans.find((p) => p.id === planId)?.name}.`,
  });
};
```
Plan switching only updates local React state and shows a toast. It does not initiate a payment checkout session or modify user tier in the database.

### 8.4 Billing History and Invoices
The Invoices card (`Billing.jsx:267-319`) displays historical billing transactions.

#### Verification Findings:
- **Mock Invoice Array:** Invoices are populated from a hardcoded array (`Billing.jsx:59-81`):
  - `INV-2026-09` · Sep 20, 2026 · $19.00 · Status: `Paid`
  - `INV-2026-08` · Aug 20, 2026 · $19.00 · Status: `Paid`
  - `INV-2026-07` · Jul 20, 2026 · $19.00 · Status: `Paid`
- **Download Simulation:** Clicking the `Download` button triggers a toast: *"Downloading invoice {id}.pdf"* (`Billing.jsx:302-307`). No PDF is generated or downloaded.

#### Billing Specification Table
| Billing Element | Data Source | Actual Behavior | Persistence | Status |
|---|---|---|---|---|
| **Current Plan Card** | Local React state (`useState("pro")`)| Displays plan, cost, and renewal date | React memory only | `PARTIALLY IMPLEMENTED` (Mock) |
| **Manage Payment Button**| Hardcoded toast handler | Shows toast ("Redirecting to Stripe...") | None | `NOT IMPLEMENTED` |
| **AI Test Quota Bar** | Hardcoded text & inline width | Displays static 64% (642/1000) | None | `PARTIALLY IMPLEMENTED` (Mock) |
| **Runner Minutes Bar** | Hardcoded text & inline width | Displays static 34% (68/200) | None | `PARTIALLY IMPLEMENTED` (Mock) |
| **Available Plan Cards** | Static `plans` array in JSX | Renders features, prices, and badges | None | `IMPLEMENTED` (Presentation) |
| **Plan Switch Buttons** | `handleSelectPlan` handler | Updates local state & displays toast | React memory only | `PARTIALLY IMPLEMENTED` (Mock) |
| **Invoice Registry** | Static `invoices` array in JSX | Renders invoice rows, dates, and amounts| None | `PARTIALLY IMPLEMENTED` (Mock) |
| **Download Invoice** | Hardcoded toast handler | Shows toast ("Downloading invoice...") | None | `NOT IMPLEMENTED` |

---

## 9. Frontend-to-Backend Workflows

### 9.1 Traceability Analysis of 17 Workflows

#### Workflow 1: Load Profile
- `UserProfile.jsx:24-40` invokes `getUserProfileApi()` on mount.
- Issues `GET /api/users/me` to backend controller `me` (`user.controller.js:4-18`).
- Service `getUserById` (`user.service.js:3-23`) fetches record from PostgreSQL `prisma.user.findUnique`.
- Returns user profile data to populate input fields. (`IMPLEMENTED`)

#### Workflow 2: Change Avatar
- User clicks `Change Avatar` $\rightarrow$ selects file in hidden `<input type="file">`.
- `FileReader.readAsDataURL` converts image to base64 Data URI in local React state.
- No backend API is invoked until user clicks `Save Changes`. (`PARTIALLY IMPLEMENTED`)

#### Workflow 3: Save Profile Information
- User clicks `Save Changes` $\rightarrow$ invokes `updateUserProfileApi(profile)` (`user.service.js:19-35`).
- Issues `PATCH /api/users/me` to `update` controller (`user.controller.js:20-56`).
- Validated by Zod `meValid`. If valid, updates database via `prisma.user.update`. (`IMPLEMENTED`)

#### Workflow 4: Change Workspace Theme
- User clicks theme card $\rightarrow$ executes `setTheme(themeId)` via `ThemeContext.jsx`.
- Mutates DOM attribute `data-theme` and class `dark` on `<html>`. Writes to `localStorage.covai_theme`. (`IMPLEMENTED`)

#### Workflow 5: Save Code Editor Preferences
- User adjusts font/minimap/wrap controls $\rightarrow$ clicks `Save Preferences`.
- Writes key-value pairs into `localStorage`. Editor component does not consume these keys. (`PARTIALLY IMPLEMENTED`)

#### Workflow 6: Update Password
- User fills password form $\rightarrow$ clicks `Update Password`.
- Triggers 800ms `setTimeout` simulation and displays toast. No backend call. (`PARTIALLY IMPLEMENTED` - Mock)

#### Workflow 7: Set Up 2FA
- User clicks `Set Up 2FA` $\rightarrow$ toggles local boolean state and displays toast. No backend call. (`NOT IMPLEMENTED` - Mock)

#### Workflow 8: Load Active Sessions
- Section mounts $\rightarrow$ displays static hardcoded session card in JSX. No API call. (`PARTIALLY IMPLEMENTED` - Mock)

#### Workflow 9: Delete Account
- User clicks `Delete Account` $\rightarrow$ displays toast advising to email support. No deletion call. (`NOT IMPLEMENTED`)

#### Workflow 10: Save Notification Preferences
- User toggles alert checkboxes $\rightarrow$ clicks `Save Preferences`.
- Displays toast message. Preferences remain in React state only. (`PARTIALLY IMPLEMENTED` - Mock)

#### Workflow 11: Load Notification History
- User switches to `Recent History` tab $\rightarrow$ calls `notificationService.getNotifications(1, 30)`.
- Issues `GET /api/notifications` to backend controller. Loads records from PostgreSQL. (`IMPLEMENTED`)

#### Workflow 12: Load Subscription Information
- Component mounts $\rightarrow$ renders static plan details from local array. No API call. (`PARTIALLY IMPLEMENTED` - Mock)

#### Workflow 13: Load Usage Quotas
- Component mounts $\rightarrow$ renders hardcoded quota numbers and bar widths. No API call. (`PARTIALLY IMPLEMENTED` - Mock)

#### Workflow 14: Switch Subscription Plan
- User clicks plan switch button $\rightarrow$ updates local state and displays toast. No payment API. (`PARTIALLY IMPLEMENTED` - Mock)

#### Workflow 15: Manage Payment
- User clicks `Manage Payment` $\rightarrow$ displays toast mentioning Stripe. No redirection. (`NOT IMPLEMENTED` - Mock)

#### Workflow 16: Download Invoice
- User clicks invoice download icon $\rightarrow$ displays toast. No PDF generation or download. (`NOT IMPLEMENTED` - Mock)

#### Workflow 17: Log Out
- User clicks `Log Out` in sidebar $\rightarrow$ confirms dialog.
- Executes `logout()` from `useAuth()`, clears `localStorage` tokens, and redirects to `"/"`. (`IMPLEMENTED`)

### 9.2 Workflow Traceability Matrix
| Workflow | Frontend Entry Point | API / Service | Backend Handler | Persistence | UI Feedback | Status |
|---|---|---|---|---|---|---|
| **1. Load Profile** | `UserProfile.useEffect` | `getUserProfileApi` | `userController.me` | PostgreSQL (`User`) | Inputs populated | `IMPLEMENTED` |
| **2. Change Avatar** | File input `onChange` | Pure client `FileReader` | None | Base64 in state | Avatar preview | `PARTIALLY IMPLEMENTED` |
| **3. Save Profile** | `handleSave` button | `updateUserProfileApi` | `userController.update` | PostgreSQL (`User`) | Toast "Profile Saved" | `IMPLEMENTED` |
| **4. Change Theme** | Theme card `onClick` | `ThemeContext.setTheme` | None (Client DOM) | `localStorage.covai_theme` | Instant theme shift | `IMPLEMENTED` |
| **5. Save Editor Prefs**| `handleSavePreferences` | Local storage APIs | None | `localStorage.editor_*` | Toast "Preferences Saved" | `PARTIALLY IMPLEMENTED` |
| **6. Update Password** | Form `onSubmit` | None (`setTimeout` mock) | None | None | Toast "Password Updated" | `PARTIALLY IMPLEMENTED` (Mock) |
| **7. Set Up 2FA** | `handleToggle2FA` | None | None | None | Toast "2FA Enabled" | `NOT IMPLEMENTED` (Mock) |
| **8. Load Sessions** | On mount | None | None | None | Static session card | `PARTIALLY IMPLEMENTED` (Mock) |
| **9. Delete Account** | `onClick` button | None | None | None | Toast "Action Restricted"| `NOT IMPLEMENTED` |
| **10. Save Notif Prefs**| `handleSavePreferences` | None | None | None | Toast "Preferences Saved" | `PARTIALLY IMPLEMENTED` (Mock) |
| **11. Load Notif Hist** | Tab change / on mount | `getNotifications` | `notificationController.get` | PostgreSQL (`Notification`)| History rows rendered | `IMPLEMENTED` |
| **12. Load Sub Info** | On mount | None | None | None | Static plan display | `PARTIALLY IMPLEMENTED` (Mock) |
| **13. Load Quotas** | On mount | None | None | None | Static progress bars | `PARTIALLY IMPLEMENTED` (Mock) |
| **14. Switch Plan** | `handleSelectPlan` | None | None | None | Toast "Plan Changed" | `PARTIALLY IMPLEMENTED` (Mock) |
| **15. Manage Payment** | `onClick` button | None | None | None | Toast "Billing Portal" | `NOT IMPLEMENTED` (Mock) |
| **16. Download Invoice**| `onClick` button | None | None | None | Toast "Download Started" | `NOT IMPLEMENTED` (Mock) |
| **17. Log Out** | `handleLogout` in dialog | `useAuth().logout` | `auth.controller.js` (Optional) | Purges localStorage | Redirects to `"/"` | `IMPLEMENTED` |

---

## 10. UI Specification Tables

### 10.1 Profile Settings Specification Table
| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `user-avatar-image` | Image Container | Displays image if `avatarUrl` exists, else 2-char initials monogram; click opens lightbox. | Render user avatar visual identity. |
| 2 | `change-avatar-button` | Action Button | Programmatically triggers `#avatar-upload` file input; icon `Upload`. | Open native file picker to select new photo. |
| 3 | `avatar-file-input` | Hidden Input | `type="file"`, `accept="image/*"`, reads file via `FileReader.readAsDataURL`. | Select image file from filesystem. |
| 4 | `remove-avatar-button` | Action Button | Rendered only when `avatarUrl` is non-empty; icon `Trash2`; sets `avatarUrl = ""`. | Clear avatar and revert to initials. |
| 5 | `full-name-input` | Text Field | Bound to `profile.name`; placeholder `"e.g. Jane Doe"`; Zod max 100 chars. | Edit user's public display name. |
| 6 | `email-address-input` | Text Field | Bound to `profile.email`; attribute `readOnly`; locked background with `Lock` icon. | Display primary account email address. |
| 7 | `email-verified-badge` | Status Badge | Hardcoded visual element; icon `CheckCircle2`; text `"Verified"` in green. | Indicate verified email status. |
| 8 | `job-title-input` | Text Field | Bound to `profile.jobTitle`; placeholder `"e.g. Senior QA Engineer"`; Zod max 100 chars. | Edit user's professional role. |
| 9 | `bio-textarea` | Textarea | Bound to `profile.bio`; attribute `maxLength={500}`; placeholder text; resizable. | Input user background and bio text. |
| 10 | `bio-character-counter` | Counter Label | Formatted dynamically as `{length} / 500`; font-mono; muted text. | Display remaining allowable bio characters. |
| 11 | `profile-cancel-button` | Action Button | Resets `profile` to `initialProfile` snapshot; displays info toast. | Revert unsaved profile modifications. |
| 12 | `profile-save-button` | Submit Button | Disabled when `isSaving === true`; executes `updateUserProfileApi(profile)`. | Persist profile updates to PostgreSQL. |

### 10.2 Appearance Settings Specification Table
| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `dark-theme-card` | Selectable Card | `id: "dark"`; sets theme immediately; shows checkmark when selected; preview strip. | Enable developer dark mode. |
| 2 | `light-theme-card` | Selectable Card | `id: "light"`; sets theme immediately; shows checkmark when selected; preview strip. | Enable bright light mode. |
| 3 | `system-theme-card` | Selectable Card | `id: "system"`; synchronizes with OS via media query; shows checkmark when selected. | Enable OS-synchronized theme mode. |
| 4 | `font-family-selector` | Dropdown (`<select>`)| 4 options (JetBrains Mono, Fira Code, Menlo, Consolas); value bound to `fontFamily`. | Select code editor font family. |
| 5 | `font-size-pill-12px` | Toggle Button | Sets `fontSize = "12px"`; highlighted when active. | Select 12px editor font size. |
| 6 | `font-size-pill-13px` | Toggle Button | Sets `fontSize = "13px"`; default active selection. | Select 13px editor font size. |
| 7 | `font-size-pill-14px` | Toggle Button | Sets `fontSize = "14px"`; highlighted when active. | Select 14px editor font size. |
| 8 | `font-size-pill-15px` | Toggle Button | Sets `fontSize = "15px"`; highlighted when active. | Select 15px editor font size. |
| 9 | `font-size-pill-16px` | Toggle Button | Sets `fontSize = "16px"`; highlighted when active. | Select 16px editor font size. |
| 10 | `minimap-checkbox` | Checkbox | Bound to `showMinimap`; default `true`; controls outline gutter. | Toggle Monaco editor minimap. |
| 11 | `line-numbers-checkbox` | Checkbox | Bound to `lineNumbers`; default `true`; controls gutter line numbering. | Toggle editor line numbering. |
| 12 | `word-wrap-checkbox` | Checkbox | Bound to `wordWrap`; default `false`; controls line wrap behavior. | Toggle editor viewport line wrapping. |
| 13 | `appearance-save-button`| Action Button | Writes all appearance and editor options to `localStorage`; shows success toast. | Save editor and appearance preferences. |

### 10.3 Security Settings Specification Table
| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `current-password-input` | Password Field | Controlled input; toggle button switches between `password` and `text`. | Verify user's current password. |
| 2 | `new-password-input` | Password Field | Controlled input; toggle button; requires $\ge 8$ chars; drives strength gauge. | Enter desired new password. |
| 3 | `confirm-password-input` | Password Field | Controlled input; toggle button; must exactly match `newPassword`. | Confirm new password entry. |
| 4 | `password-visibility-toggle`| Toggle Button | Icon `Eye` / `EyeOff`; toggles password visibility state. | Reveal or obscure masked password text. |
| 5 | `password-strength-gauge` | Progress Meter | Dynamically computes 0–100 score; renders color bar and label (Weak/Fair/Good/Strong). | Provide visual password strength feedback. |
| 6 | `update-password-button`| Submit Button | Validates inputs client-side; executes mock 800ms `setTimeout` simulation. | Submit password change request. |
| 7 | `two-factor-status-badge`| Status Badge | Renders `"Enabled"` (green) or `"Disabled"` (muted) based on local boolean state. | Display active 2FA protection status. |
| 8 | `setup-2fa-button` | Toggle Button | Toggles `twoFactorEnabled` boolean state and displays toast; no backend call. | Enable or disable simulated 2FA. |
| 9 | `active-session-card` | Information Card | Displays static hardcoded session details (`Windows PC · Chrome Browser`, IP, Location).| Inspect active client login sessions. |
| 10 | `delete-account-button` | Danger Button | Red outline button; displays warning toast directing user to support email. | Request permanent account termination. |

### 10.4 Notifications Settings Specification Table
| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `preferences-tab-button` | Tab Button | Switches view to preferences (`activeTab = "preferences"`); icon `Sliders`. | Access notification preference settings. |
| 2 | `history-tab-button` | Tab Button | Switches view to history (`activeTab = "history"`); icon `Clock`; shows unread badge. | Access notification audit history. |
| 3 | `email-failures-checkbox` | Checkbox | Bound to `prefs.emailFailures`; default `true`; email alerts for failed runs. | Toggle test failure email notifications. |
| 4 | `email-weekly-checkbox` | Checkbox | Bound to `prefs.emailWeekly`; default `false`; weekly summary report email. | Toggle weekly digest email notifications. |
| 5 | `inapp-ai-done-checkbox` | Checkbox | Bound to `prefs.inAppAiDone`; default `true`; in-app alert when AI generation finishes. | Toggle AI test generation in-app alerts. |
| 6 | `coverage-drop-checkbox` | Checkbox | Bound to `prefs.inAppCoverageDrop`; default `true`; alert if coverage drops < 80%. | Toggle coverage drop threshold alerts. |
| 7 | `job-updates-checkbox` | Checkbox | Bound to `prefs.inAppJobUpdates`; default `true`; alert on job worker status changes. | Toggle job queue status in-app alerts. |
| 8 | `sound-chimes-checkbox` | Checkbox | Bound to `prefs.soundAlerts`; default `true`; auditory cue for task completion. | Toggle notification sound feedback. |
| 9 | `notifications-save-button`| Action Button | Displays toast message; does not persist preferences to database or localStorage. | Save notification preferences. |
| 10 | `unread-count-summary` | Text Display | Displays `"{N} unread"` or `"You're all caught up"`. | Summarize unread notification count. |
| 11 | `mark-all-read-button` | Action Button | Visible when `unreadCount > 0`; calls `notificationService.markAllAsRead()`. | Mark all notification records as read. |
| 12 | `notification-history-item`| Interactive Card| Click marks individual item as read (`PATCH /api/notifications/:id/read`). | View notification details and project scope. |
| 13 | `load-more-history-button`| Action Button | Visible when `hasMore === true`; loads subsequent page of notification history. | Page through older notification items. |

### 10.5 Billing Settings Specification Table
| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `current-plan-header` | Heading Tag | Displays `"Current Plan: Pro Developer"` and active status badge. | Identify user's current subscription plan. |
| 2 | `manage-payment-button` | Action Button | Displays toast mentioning Stripe Customer Portal; no redirect. | Open external payment management portal. |
| 3 | `ai-quota-progress-bar` | Progress Bar | Hardcoded width `64%` and text `"642 / 1,000 requests used"`. | Display monthly AI request consumption. |
| 4 | `runner-minutes-progress-bar`| Progress Bar | Hardcoded width `34%` and text `"68 / 200 minutes used"`. | Display monthly runner minutes consumption. |
| 5 | `starter-free-card` | Plan Card | Details $0 plan features; contains `"Switch to Starter Free"` button. | Present Free plan tier details. |
| 6 | `pro-developer-card` | Plan Card | Details $19 plan features; `POPULAR` badge; contains disabled `"Current Plan"` button. | Present Pro Developer plan tier details. |
| 7 | `team-enterprise-card` | Plan Card | Details $49 plan features; contains `"Switch to Team & Enterprise"` button. | Present Enterprise plan tier details. |
| 8 | `plan-switch-action-button`| Action Button | Switches `currentPlan` local state and shows toast; no payment checkout. | Select or switch active subscription tier. |
| 9 | `invoice-row-item` | Table Row Card | Displays invoice ID, date, amount ($19.00), and green `"Paid"` badge. | Present historical transaction receipt. |
| 10 | `download-invoice-button` | Action Button | Icon `Download`; displays simulated toast; no PDF download. | Download invoice receipt document. |

---

## 11. Screenshot-to-Code Comparison

The following table provides a rigorous element-by-element cross-comparison between visual controls captured in the five screenshots and actual implementation facts in the repository:

| Settings Section | UI Element | Screenshot Observation | Actual Implementation | Status | Evidence |
|---|---|---|---|---|---|
| **Profile** | Profile Avatar | Monogram "Q" inside circular container | Derived from `profile.name` initials when `avatarUrl` is empty | `MATCH` | `UserProfile.jsx:116-118` |
| **Profile** | Change Avatar Button | Button with `Upload` icon | Programmatically triggers hidden `<input type="file">` | `MATCH` | `UserProfile.jsx:164-173` |
| **Profile** | File Size / Format Copy | Text: "PNG, JPG, or GIF up to 2MB" | Text exists in JSX, but client does not enforce size limit | `PARTIAL MATCH` | `UserProfile.jsx:160-162` |
| **Profile** | Full Name Input | Text input with value | Bound to `profile.name`, persisted via `PATCH /api/users/me` | `MATCH` | `UserProfile.jsx:201-210` |
| **Profile** | Email Address Input | Input with lock icon | Input is `readOnly`; backend ignores email updates | `MATCH` | `UserProfile.jsx:224-234` |
| **Profile** | Verified Status Badge | Green badge: "Verified" with check icon | Hardcoded visual element; not stored in database | `PARTIAL MATCH` | `UserProfile.jsx:218-221` |
| **Profile** | Job Title Input | Placeholder text | Bound to `profile.jobTitle`, persisted to database | `MATCH` | `UserProfile.jsx:243-252` |
| **Profile** | Bio Input & Counter | Textarea with counter `0 / 500` | Attribute `maxLength={500}`, counter dynamically formatted | `MATCH` | `UserProfile.jsx:254-273` |
| **Profile** | Action Buttons | "Cancel" and "Save Changes" | "Cancel" reverts form, "Save Changes" calls API | `MATCH` | `UserProfile.jsx:275-294` |
| **Appearance** | Theme Cards | Dark, Light, System cards | Bound to `ThemeContext`, sets DOM `data-theme` attribute | `MATCH` | `Appearance.jsx:112-166` |
| **Appearance** | Theme Selection Mark | Checkmark on "Light Clean" card | Selected card renders white check inside primary circle | `MATCH` | `Appearance.jsx:133-137` |
| **Appearance** | Font Family Selector | Dropdown with "JetBrains Mono" | `<select>` updates state and saves to `localStorage` | `MATCH` | `Appearance.jsx:195-208` |
| **Appearance** | Font Size Pills | Buttons 12px–16px (13px active) | Renders 5 pills; updates state and saves to `localStorage` | `MATCH` | `Appearance.jsx:216-231` |
| **Appearance** | Minimap / Lines / Wrap | Three checkboxes with sub-labels | Checkboxes update state and save to `localStorage` | `MATCH` | `Appearance.jsx:235-290` |
| **Appearance** | Editor Setting Effect | Implies settings alter active editor | Monaco editor hardcodes options and ignores localStorage | `MISMATCH` | `Editor.jsx:1370-1376` |
| **Security** | Password Inputs | Current, New, Confirm inputs with eye | Controlled inputs with working visibility toggle buttons | `MATCH` | `Security.jsx:146-254` |
| **Security** | Update Password Action| Button: "Update Password" | Executes mock `setTimeout` simulation; no backend call | `MISMATCH` | `Security.jsx:84-98` |
| **Security** | 2FA Section | Badge: "Disabled", "Set Up 2FA" button | Inverts local boolean state; no real 2FA infrastructure | `PARTIAL MATCH` | `Security.jsx:270-316` |
| **Security** | Active Sessions Card | Windows PC · Chrome, Vietnam IP | Static hardcoded card in JSX; no session API | `MISMATCH` | `Security.jsx:329-352` |
| **Security** | Delete Account Button | Danger zone with outline button | Displays toast advising to contact support; no API call | `PARTIAL MATCH` | `Security.jsx:369-383` |
| **Notifications**| Tab Navigation | "Preferences" and "Recent History (4)" | Tabs switch views; badge reflects real unread count | `MATCH` | `NotificationsSettings.jsx:122-153` |
| **Notifications**| Email Checkboxes | Test Failures, Weekly Digest | Checkboxes update state; backend email service not wired | `PARTIAL MATCH` | `NotificationsSettings.jsx:175-214` |
| **Notifications**| In-App Triggers | AI Ready, Coverage Drop, Job Updates | AI & Job alerts exist on backend; Coverage drop unhandled | `PARTIAL MATCH` | `NotificationsSettings.jsx:234-294` |
| **Notifications**| Chime Checkbox | "Play Notification Chimes" checkbox | Checkbox updates state, but audio playback is absent | `PARTIAL MATCH` | `NotificationsSettings.jsx:313-331` |
| **Notifications**| Save Preferences Action| Button: "Save Preferences" | Shows toast only; does not save to DB or localStorage | `MISMATCH` | `NotificationsSettings.jsx:99-105` |
| **Billing** | Current Plan Card | "Pro Developer", $19/mo, Oct 20 renewal| Static hardcoded card in JSX; not loaded from Stripe | `PARTIAL MATCH` | `Billing.jsx:109-128` |
| **Billing** | Manage Payment Button | Action button | Shows toast mentioning Stripe; no redirection | `MISMATCH` | `Billing.jsx:130-142` |
| **Billing** | Usage Progress Bars | 64% AI Quota, 24% Runner Minutes | Hardcoded width percentages and request counts in JSX | `MISMATCH` | `Billing.jsx:145-189` |
| **Billing** | Available Plan Cards | Starter Free, Pro, Team & Enterprise | Renders cards and features; switching updates state only | `PARTIAL MATCH` | `Billing.jsx:198-262` |
| **Billing** | Invoice Rows & Download | 3 invoices ($19.00 Paid) with download | Static mock array; download button shows toast only | `MISMATCH` | `Billing.jsx:277-317` |

---

## 12. Findings and Limitations

### 12.1 Detailed Technical Findings

1. **Monaco Editor Decoupling from Appearance Settings:**
   - *Evidence:* `Appearance.jsx:72-76` writes `editor_font_size`, `editor_font_family`, `editor_minimap`, and `editor_word_wrap` into `localStorage`. In contrast, `Editor.jsx:1370-1376` hardcodes font size to `13.5`, font family to `"var(--font-mono), monospace"`, and initializes minimap and wrap states independently of `localStorage`.
   - *Impact:* Changes made in the Appearance & Editor settings panel have zero effect on the actual code editor used in the workspace.
2. **Avatar Base64 vs. Backend Zod URL Validation Conflict:**
   - *Evidence:* `UserProfile.jsx:144` encodes avatar files as Data URIs (`data:image/...;base64,...`). The backend Zod validator `meValid` (`user.validation.js:10-14`) validates `avatarUrl` using `z.string().url()`.
   - *Impact:* Submitting a profile update with an uploaded avatar will trigger an HTTP 400 validation error on the backend because Zod's default URL validator rejects data URIs.
3. **Simulated Password Update in Security Panel:**
   - *Evidence:* `Security.jsx:86-98` uses an 800ms `setTimeout` to simulate password changes, and `server/src/routes/auth.route.js` contains no route for password updates.
   - *Impact:* Users cannot change their account passwords through the settings interface. The UI creates the false impression that passwords have been updated.
4. **Unpersisted Notification Preferences:**
   - *Evidence:* `NotificationsSettings.jsx:99-105` displays a success toast without writing state to `localStorage` or dispatching an API call.
   - *Impact:* All customized notification preferences revert to default values whenever the user refreshes or re-enters the application.
5. **Mock Billing and Quota Presentation:**
   - *Evidence:* `Billing.jsx:59-81` and `:145-189` utilize hardcoded values for invoices, AI requests (642/1000), runner minutes (68/200), and plan switching.
   - *Impact:* Compute quotas are visual mockups and do not reflect actual database usage counters in `model User`.

### 12.2 Findings Inventory Table
| Finding | Evidence | Impact | Status | Recommendation |
|---|---|---|---|---|
| **Editor Preferences Ignored** | `Editor.jsx:1370` vs `Appearance.jsx:72` | Editor does not reflect user typography/layout choices | `VERIFIED DEFECT` | Refactor `Editor.jsx` to initialize and subscribe to `localStorage` editor options. |
| **Avatar Base64 URL Rejection** | `user.validation.js:12` vs `UserProfile.jsx:144` | Profile photo save fails with HTTP 400 validation error | `VERIFIED DEFECT` | Update Zod schema to accept data URIs or integrate multipart S3/disk upload. |
| **Simulated Password Change** | `Security.jsx:86` | Passwords are not updated on the backend | `VERIFIED DEFECT` | Implement `POST /api/auth/change-password` controller and route. |
| **Unsaved Notification Settings**| `NotificationsSettings.jsx:99` | Notification toggles reset upon page reload | `VERIFIED DEFECT` | Add `notificationPreferences` JSON column to `User` model and persist on save. |
| **Unwired Email Dispatch** | `sendEmail.js:11` not in test workers | Failed test run alerts are never sent via email | `MISSING IMPLEMENTATION` | Wire `sendEmail` into `runTestsJob.service.js` failure callbacks. |
| **Hardcoded Quotas and Billing**| `Billing.jsx:147-189` | Quotas and invoices are static mock data | `MOCK DATA` | Bind usage meters to `User.aiUsageCount` and integrate Stripe webhooks. |
| **Hardcoded Email Verification**| `UserProfile.jsx:218-221` | "Verified" badge is static; unverified emails show as verified | `UI/BACKEND MISMATCH` | Add `emailVerified` boolean to `schema.prisma` and bind badge dynamically. |
| **Missing Unsaved Dirty Warning**| `Layout.jsx:874-943` | Switching settings tabs discards unsubmitted form values | `USABILITY LIMITATION` | Introduce a form dirty check prompt before switching `activeSetting`. |

---

## 13. Recommendations

### 13.1 Short-Term Corrections
1. **Wire Monaco Editor to Local Storage:**
   Update `client/src/components/dashboard/Editor.jsx` to load initial options from `localStorage`:
   ```javascript
   const savedFontSize = parseFloat(localStorage.getItem("editor_font_size")) || 13.5;
   const savedFontFamily = localStorage.getItem("editor_font_family") || "var(--font-mono), monospace";
   const savedMinimap = localStorage.getItem("editor_minimap") !== "false";
   const savedWrap = localStorage.getItem("editor_word_wrap") === "true";
   ```
2. **Resolve Avatar URL Validation:**
   Modify `server/src/validators/user.validation.js` to permit Data URIs alongside standard HTTP URLs:
   ```javascript
   avatarUrl: z.string().refine((val) => val.startsWith("data:image/") || z.string().url().safeParse(val).success, {
     message: "Must be a valid URL or image Data URI!",
   }).optional().or(z.literal("")),
   ```
3. **Persist Notification Preferences:**
   Store notification preferences in `localStorage` under `covai_notification_prefs` as an immediate fix, followed by persistent database storage.

### 13.2 Long-Term Strategic Enhancements
1. **Real Password Update Endpoint:**
   Implement `POST /api/auth/change-password` on the backend, validating current password hash using `bcrypt.compare`, verifying new password complexity, and invalidating existing refresh tokens upon update.
2. **Stripe Billing Integration:**
   Replace the mock billing presentation with real Stripe Checkout sessions and Customer Portal links, dynamically retrieving quota consumption from `User.aiUsageCount`.
3. **Real-time Two-Factor Authentication:**
   Implement time-based one-time password (TOTP) verification using `speakeasy` and `qrcode` libraries on the backend, storing encrypted secrets in PostgreSQL.

---

## 14. Source References

The findings, behaviors, and limitations documented in this report were verified against the following repository source files:

### Frontend Implementation Files
- [`client/src/components/dashboard/settings/SettingsSidebar.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/settings/SettingsSidebar.jsx): Lines 1–170 (Navigation options, responsive tab mode, and logout confirm dialog).
- [`client/src/components/dashboard/settings/UserProfile.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/settings/UserProfile.jsx): Lines 1–299 (Profile photo avatar upload, initials fallback, personal details inputs, and bio counter).
- [`client/src/components/dashboard/settings/Appearance.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/settings/Appearance.jsx): Lines 1–308 (Theme cards, editor font/size controls, minimap, line numbers, and word wrap).
- [`client/src/components/dashboard/settings/Security.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/settings/Security.jsx): Lines 1–389 (Password strength calculation, simulated update handler, 2FA toggle, active sessions, and delete account).
- [`client/src/components/dashboard/settings/NotificationsSettings.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/settings/NotificationsSettings.jsx): Lines 1–442 (Preferences checkboxes, unread count badge, history list, and mark-as-read handlers).
- [`client/src/components/dashboard/settings/Billing.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/settings/Billing.jsx): Lines 1–323 (Plan cards, compute usage meters, mock invoices, and simulated download actions).
- [`client/src/components/dashboard/settings/WebhookSettings.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/settings/WebhookSettings.jsx): Lines 1–315 (Project-specific GitHub webhook management).
- [`client/src/components/dashboard/Layout.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/Layout.jsx): Lines 21, 874–881, 930–943 (IDE settings sidebar and view mounting).
- [`client/src/components/dashboard/ActivityBar.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/ActivityBar.jsx): Line 26 (Settings Activity Bar button registration).
- [`client/src/components/dashboard/Editor.jsx`](file:///d:/NCKH/CovAI-/client/src/components/dashboard/Editor.jsx): Lines 604–610, 1369–1378 (Monaco Editor option definitions and preference disconnection).
- [`client/src/contexts/ThemeContext.jsx`](file:///d:/NCKH/CovAI-/client/src/contexts/ThemeContext.jsx): Lines 1–73 (Theme provider, media query listener, and DOM mutation logic).
- [`client/src/services/user.service.js`](file:///d:/NCKH/CovAI-/client/src/services/user.service.js): Lines 1–36 (Axios API calls for user profile retrieval and update).
- [`client/src/services/notification.service.js`](file:///d:/NCKH/CovAI-/client/src/services/notification.service.js): Lines 1–149 (Client API calls for notification retrieval, unread count, and read status).

### Backend Implementation Files
- [`server/src/routes/user.route.js`](file:///d:/NCKH/CovAI-/server/src/routes/user.route.js): Lines 1–11 (Express routes for `GET /api/users/me` and `PATCH /api/users/me`).
- [`server/src/controllers/user.controller.js`](file:///d:/NCKH/CovAI-/server/src/controllers/user.controller.js): Lines 1–57 (Controllers `me` and `update` handling profile requests).
- [`server/src/services/user.service.js`](file:///d:/NCKH/CovAI-/server/src/services/user.service.js): Lines 1–64 (Database operations on `prisma.user`).
- [`server/src/validators/user.validation.js`](file:///d:/NCKH/CovAI-/server/src/validators/user.validation.js): Lines 1–26 (Zod schema `meValid` for profile fields).
- [`server/src/routes/auth.route.js`](file:///d:/NCKH/CovAI-/server/src/routes/auth.route.js): Lines 1–32 (Authentication route registry, absence of change-password endpoint).
- [`server/src/routes/notification.route.js`](file:///d:/NCKH/CovAI-/server/src/routes/notification.route.js): Lines 1–17 (Routes for notifications, unread count, and read status).
- [`server/src/services/notification.service.js`](file:///d:/NCKH/CovAI-/server/src/services/notification.service.js): Lines 1–60 (Notification creation, Socket.IO dispatch, and event listeners).
- [`server/src/utils/sendEmail.js`](file:///d:/NCKH/CovAI-/server/src/utils/sendEmail.js): Lines 1–30 (Nodemailer transporter and email dispatch function).
- [`server/prisma/schema.prisma`](file:///d:/NCKH/CovAI-/server/prisma/schema.prisma): Lines 10–34 (`model User`), lines 186–200 (`model Notification`).
