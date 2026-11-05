# COVAI Register UI — Implementation Analysis

## 1. Overview

The **Register interface** is the user account onboarding gateway of the COVAI platform (`/register`). Its primary responsibility is to register new software engineering and developer accounts, establish user identity credentials in the PostgreSQL database, automatically initialize authenticated sessions, and redirect new users directly to the project selection dashboard (`/projects`).

The interface shares the unified authentication architecture implemented in `AuthLayout` and `AuthForm`, rendering a split two-column responsive layout:
1. **Left Panel (Technical Showcase):** A desktop-only (`hidden lg:flex`) branding and feature demonstration pane. It showcases the COVAI terminal emblem, release version identifier (`v2.4`), core value proposition heading, a simulated Monaco-style Jest test execution preview with deterministic branch coverage evidence (`tests/checkout.test.js`), and three architectural pillars (Control Flow, Test Synthesis, and Sandbox Runner).
2. **Right Panel (Registration Form Container):** A focused form column containing:
   - **Global Navigation & Utilities:** Top bar with a "Back to home" return link (`/`) and a compact theme toggle cycling between light, dark, and system themes.
   - **Alternative Authentication:** Single-click GitHub OAuth 2.0 integration (`#auth-github-btn`).
   - **Direct Account Creation Form:** Full Name, Email Address, Password, and Confirm Password fields with dynamic password visibility toggles, client-side format and matching validation, inline error messaging, and an immediate auto-login transition upon submission.
   - **Mode Switcher:** Contextual navigation prompt and link returning to the Sign In interface.

The application is built with **React 19**, **Vite**, **React Router v7**, and styled with **Tailwind CSS v4** utilizing strict CSS variable tokens defined in `client/src/index.css`.

---

## 2. Implementation Files

The following table documents all frontend and backend source files responsible for the Register interface and its underlying user creation and session initialization pipeline:

| File Path | Component/Function | Responsibility | Evidence |
|---|---|---|---|
| `client/src/pages/RegisterPage.jsx` | `RegisterPage` | Dedicated route page mounting `AuthLayout` with prop `initialMode="register"`. | Lines 1–5: `export default function RegisterPage() { return <AuthLayout initialMode="register" />; }` |
| `client/src/components/auth/AuthLayout.jsx` | `AuthLayout` | Primary 2-column layout container; manages mode state (`"register"`), renders the left technical showcase and right form wrapper, header navigation, and footer notice. | Lines 28–139: Mode initialization, `ARCHITECTURE_PILLARS` grid, `#auth-logo`, `#auth-back-home`, `<ThemeSelector compact />`, `<CodePreview />`, and conditional form rendering. |
| `client/src/components/auth/AuthForm.jsx` | `AuthForm` | Interactive form component rendering full name, email, password, and confirm password fields in registration mode; handles validation, submission, loading states, and auto-login redirection. | Lines 31–408: Form states (`name`, `email`, `password`, `confirm`), `validate()`, `handleSubmit()`, `registerApi` invocation, `#auth-name`, `#auth-confirm`, `#auth-toggle-to-login`. |
| `client/src/components/auth/CodePreview.jsx` | `CodePreview` | Syntax-highlighted mock IDE/test runner card displaying Jest 29.0 execution, covered branch indicators, execution duration, and pass status. | Lines 1–239: Static tokenized code representation of `tests/checkout.test.js`, macOS-style title bar controls, line gutter checkmarks, branch execution status bar. |
| `client/src/components/common/ThemeSelector.jsx` | `ThemeSelector` | Global theme switcher; in `compact` mode, cycles between light, dark, and system schemes. | Lines 4–31: Compact button cycling `light -> dark -> system`, renders `Sun`, `Moon`, or `Monitor` based on resolved theme. |
| `client/src/contexts/ThemeContext.jsx` | `ThemeProvider`, `useTheme` | Context provider managing theme state, `localStorage` key `covai_theme`, and `document.documentElement` attributes (`data-theme`, class `dark`). | Lines 9–72: Syncs state with DOM root and system media query `(prefers-color-scheme: dark)`. |
| `client/src/services/auth.service.js` | `registerApi`, `oAuthGithubApi` | Frontend HTTP client wrapper executing API calls to backend endpoints via `fetchWithAuth`. | Lines 81–104: Dispatches `POST /api/auth/register` with `{ name, email, password }`, maps Zod field errors, returns response tokens. |
| `client/src/pages/GithubCallbackPage.jsx` | `GithubCallbackPage` | OAuth callback consumer handling redirect from GitHub, exchanging authorization code for session tokens. | Lines 6–59: Reads `?code=` and `?error=`, invokes `oAuthGithubApi()`, sets `localStorage`, navigates to `/projects`. |
| `client/src/App.jsx` | `AppContent`, `RedirectIfAuthenticated`, `ProtectedRoute` | Route configuration and authentication routing guards based on `localStorage` token. | Lines 54–65, 90–97: Wraps `/register` in `RedirectIfAuthenticated` which redirects active sessions to `/projects`. |
| `client/src/hooks/useAuth.js` | `useAuth` | Custom hook decoding JWT payload from `localStorage`, exposing user identity and session management functions. | Lines 3–70: `loadUserFromStorage()`, `login()`, `logout()`, `isAuthenticated`. |
| `server/src/routes/auth.route.js` | Express Router | Backend authentication routes defining endpoints and middleware bindings. | Lines 19: `router.post("/register", authLimiter, register)`. |
| `server/src/controllers/auth.controller.js` | `register` (controller) | Backend controller validating request body with Zod, calling user creation service, setting refresh token cookie, returning access token. | Lines 11–40: `authValid.safeParse(req.body)`, cookie generation, HTTP 201 response. |
| `server/src/validators/auth.validation.js` | `authValid` | Backend Zod validation schema enforcing name (1–100 chars), valid email, and minimum password length (8 chars). | Lines 3–10: `z.object({ name: z.string().min(1).max(100), email: z.email(), password: z.string().min(8) })`. |
| `server/src/services/auth.service.js` | `register` (service) | Database user creation via Prisma: checks duplicate email, hashes password with `bcrypt` (salt rounds: 10), issues JWT tokens (access: 15m, refresh: 7d). | Lines 7–40: `prisma.user.findUnique`, `bcrypt.hash`, `prisma.user.create`, `jwt.sign`. |

---

## 3. UI Specification

The following five-column specification table details all confirmed UI elements of the COVAI Register interface, separating visible requirements and styling from code-verified targets and behaviors.

| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `BrandLogoContainer` (`#auth-logo`) | Text Link / Brand Anchor | Top-left of left panel; flex container with focus outline (`focus-visible:outline-[var(--color-focus)]`); contains brand icon, title, and version tag; source: `AuthLayout.jsx:42-58`. | Navigates user back to landing page (`/`) via React Router `Link`. |
| 2 | `BrandIcon` | Icon Container | `w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-sm shrink-0`; renders Lucide `Terminal` (`w-4 h-4 stroke-[2.5]`); source: `AuthLayout.jsx:47-49`. | Visual brand emblem representing developer CLI / terminal capability. |
| 3 | `BrandTitle` | Text (Brand Name) | Visible text: `"CovAI"`; font styling: `font-bold text-base tracking-tight text-[var(--color-text)]`; source: `AuthLayout.jsx:51-53`. | Displays application brand identity. |
| 4 | `VersionBadge` | Status / Version Badge | Visible text: `"v2.4"`; styling: `text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]`; source: `AuthLayout.jsx:54-56`. | Informs developers of the deployed platform release version. |
| 5 | `LeftPanelHeading` | Text Heading (`<h2>`) | Visible text: `"Automated Test Coverage & Deterministic Branch Verification"`; styling: `text-2xl xl:text-3xl font-bold tracking-tight text-[var(--color-text)] leading-snug mb-2.5`; source: `AuthLayout.jsx:64-66`. | Primary value proposition heading of the technical showcase panel. |
| 6 | `LeftPanelDescription` | Descriptive Text (`<p>`) | Visible text: `"CovAI synthesizes targeted unit test suites, detects missing logic paths in your Control Flow Graphs, and executes tests in a secure sandbox."`; styling: `text-sm text-[var(--color-text-secondary)] leading-relaxed`; source: `AuthLayout.jsx:67-71`. | Explains core capability: AST analysis, test generation, and sandbox execution. |
| 7 | `CodePreviewContainer` | Code Preview Component | Outer container: `w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shadow-sm font-mono text-xs`; mounted inside `AuthLayout.jsx:75`; implementation: `CodePreview.jsx:171-237`. | Interactive/demonstrative Monaco-style code card showcasing test execution evidence. |
| 8 | `CodePreviewTitleBar` | Sub-component Header Bar | `h-9 px-4 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between`; contains 3 colored dots (red `danger/80`, yellow `warning/80`, green `success/80`), label `"tests / checkout.test.js"`, and right badge `CheckCircle2` icon + `"Jest 29.0 Pass"`; source: `CodePreview.jsx:173-189`. | Displays execution context: test file name, macOS window chrome, and Jest test runner pass status. |
| 9 | `CodePreviewEditor` | Syntax-highlighted Code Display | Scrollable code area (`p-3 bg-[var(--color-bg)] leading-relaxed select-text overflow-x-auto`); displays 15 tokenized lines; lines 7 & 8 highlighted with `bg-[var(--color-primary)]/10 border-l-2 border-[var(--color-primary)]` and green checkmark `✓` (`CodePreview.jsx:191-222`). | Showcases synthesised test assertions for `checkout()` edge cases with line-level branch execution indicators. |
| 10 | `CodePreviewStatusBar` | Sub-component Status Bar | `px-3.5 py-2 bg-[var(--color-surface-secondary)] border-t border-[var(--color-border)] flex items-center justify-between text-[11px]`; left: `Terminal` icon + `"Covered branch: Line 14 (throw new Error)"`; right: `"100% Branch"` (green) and `"14ms"` (muted); source: `CodePreview.jsx:225-236`. | Summarizes coverage verification metrics: targeted branch line, 100% coverage achieved, execution speed. |
| 11 | `PillarControlFlow` | Feature Card (Pillar 1) | Card container: `p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)]`; icon: Lucide `GitBranch` (purple); title: `"Control Flow"`; description: `"AST branch graph"`; source: `AuthLayout.jsx:11-15, 80-96`. | Displays architectural pillar 1: Abstract Syntax Tree branch graph mapping. |
| 12 | `PillarTestSynthesis` | Feature Card (Pillar 2) | Card container: `p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)]`; icon: Lucide `Cpu` (purple); title: `"Test Synthesis"`; description: `"Targeted Jest suites"`; source: `AuthLayout.jsx:17-21, 80-96`. | Displays architectural pillar 2: AI-driven Jest test suite synthesis. |
| 13 | `PillarSandboxRunner` | Feature Card (Pillar 3) | Card container: `p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)]`; icon: Lucide `ShieldCheck` (purple); title: `"Sandbox Runner"`; description: `"Isolated execution"`; source: `AuthLayout.jsx:22-26, 80-96`. | Displays architectural pillar 3: Isolated test execution container security. |
| 14 | `BackToHomeLink` (`#auth-back-home`) | Navigation Text Link | Top-left of right panel; `inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] rounded-[var(--radius-sm)] py-1`; contains Lucide `ArrowLeft` (`w-3.5 h-3.5`) + text `"Back to home"`; source: `AuthLayout.jsx:106-113`. | Navigates user back to landing page (`/`) via React Router `Link`. |
| 15 | `ThemeSelectorCompact` | Icon Button | Top-right of right panel; `w-8 h-8 rounded-[var(--radius-sm)] flex items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer`; renders active theme icon (`Sun`, `Moon`, or `Monitor`); tooltip: `Theme: ${theme} (Click to switch to ${nextTheme})`; source: `AuthLayout.jsx:115`, `ThemeSelector.jsx:13-31`. | Cycles theme mode in sequence: `light -> dark -> system -> light`; persists selection in `localStorage` key `covai_theme` and toggles root CSS tokens. |
| 16 | `RegisterFormHeading` | Text Heading (`<h1>`) | Top of auth form card; visible text in register mode: `"Create developer account"`; styling: `text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-text)] mb-1.5`; source: `AuthForm.jsx:133-135`. | Establishes screen context for new developer account registration. |
| 17 | `RegisterFormDescription` | Descriptive Text (`<p>`) | Visible text in register mode: `"Automate test generation and branch coverage in minutes."`; styling: `text-xs sm:text-sm text-[var(--color-text-secondary)] leading-relaxed`; source: `AuthForm.jsx:136-140`. | Value proposition subtitle detailing benefits of account creation. |
| 18 | `GithubOAuthButton` (`#auth-github-btn`) | Action Button | `w-full h-10 px-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] text-sm font-medium transition-colors flex items-center justify-center gap-2.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] mb-4`; contains GitHub SVG mark + text `"Continue with GitHub"`; source: `AuthForm.jsx:159-167`. | Triggers `handleGithubOAuth()`; redirects browser to `https://github.com/login/oauth/authorize` with scopes `user:email repo`. |
| 19 | `EmailDivider` | Decorative Text Separator | Relative container with horizontal rule `border-t border-[var(--color-border)] w-full` and centered label `<span className="bg-[var(--color-bg)] px-3 text-[11px] font-normal text-[var(--color-text-muted)] absolute">or continue with email</span>`; source: `AuthForm.jsx:169-175`. | Visually separates OAuth from direct email/password registration. |
| 20 | `ServerErrorMessage` | Alert Banner (Conditional) | Conditionally rendered when `serverMessage` state is non-empty; `p-3 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 flex items-start gap-2 mb-4 text-xs text-[var(--color-danger)]`; Lucide `AlertCircle` icon; source: `AuthForm.jsx:177-183`. | Displays backend error response message (e.g., `"Account already exists!"` or `"Authentication failed. Please verify credentials."`). |
| 21 | `FullNameInputLabel` | Form Field Label (`<label>`) | `htmlFor="auth-name"`; `block text-xs font-medium text-[var(--color-text)] mb-1.5`; visible text: `"Full name "` with red asterisk `<span className="text-[var(--color-danger)]">*</span>`; source: `AuthForm.jsx:194-200`. | Identifies full name input requirement. |
| 22 | `FullNameInputField` (`#auth-name`) | Input Field (`type="text"`) | Input element: `w-full h-10 pl-10 pr-3.5 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] transition-colors focus:outline-none`; placeholder: `"Alex Developer"`; left icon: Lucide `User` (`w-4 h-4 text-[var(--color-text-muted)] absolute left-3.5 pointer-events-none`); source: `AuthForm.jsx:201-215`. | Controlled text input bound to `formData.name`; accepts the user's full display name. |
| 23 | `FullNameValidationError` | Validation Error Text (Conditional) | Conditionally rendered below full name input when `errors.name` is set; `mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1`; Lucide `AlertCircle` (`w-3 h-3`); source: `AuthForm.jsx:216-221`. | Informs user if full name is missing (`"Full name is required"`). |
| 24 | `EmailInputLabel` | Form Field Label (`<label>`) | `htmlFor="auth-email"`; `block text-xs font-medium text-[var(--color-text)] mb-1.5`; visible text: `"Email address "` with red asterisk `<span className="text-[var(--color-danger)]">*</span>`; source: `AuthForm.jsx:226-232`. | Identifies email address input requirement. |
| 25 | `EmailInputField` (`#auth-email`) | Input Field (`type="email"`) | Input element: `w-full h-10 pl-10 pr-3.5 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] transition-colors focus:outline-none`; placeholder: `"alex@company.com"`; left icon: Lucide `Mail` (`w-4 h-4 text-[var(--color-text-muted)] absolute left-3.5 pointer-events-none`); source: `AuthForm.jsx:233-247`. | Controlled input bound to `formData.email`; accepts user email address. |
| 26 | `EmailValidationError` | Validation Error Text (Conditional) | Conditionally rendered below email input when `errors.email` is set; `mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1`; Lucide `AlertCircle` (`w-3 h-3`); source: `AuthForm.jsx:248-253`. | Informs user of missing or malformed email format. |
| 27 | `PasswordInputLabel` | Form Field Label (`<label>`) | `htmlFor="auth-password"`; `block text-xs font-medium text-[var(--color-text)]`; visible text: `"Password "` with red asterisk `<span className="text-[var(--color-danger)]">*</span>`; source: `AuthForm.jsx:258-263`. | Identifies password input requirement. (Note: "Forgot password?" is omitted in register mode). |
| 28 | `PasswordInputField` (`#auth-password`) | Password Input Field (`type="password"` / `"text"`) | Input element: `w-full h-10 pl-10 pr-10 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] transition-colors focus:outline-none`; placeholder: `"Minimum 8 characters"`; left icon: Lucide `Lock` (`absolute left-3.5 pointer-events-none`); dynamic `type` toggled by `showPass`; source: `AuthForm.jsx:274-287`. | Controlled input bound to `formData.password`; accepts secret authentication credentials. |
| 29 | `PasswordVisibilityToggle` | Icon Button | Positioned inside password input on the right; `<button type="button" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? "Hide password" : "Show password"}>`; styling: `absolute right-3 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer`; renders Lucide `Eye` (masked) or `EyeOff` (unmasked); source: `AuthForm.jsx:288-299`. | Toggles password masking between visible cleartext and hidden bullets. |
| 30 | `PasswordValidationError` | Validation Error Text (Conditional) | Conditionally rendered below password input when `errors.password` is set; `mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1`; Lucide `AlertCircle` (`w-3 h-3`); source: `AuthForm.jsx:301-306`. | Displays password validation requirement (e.g., minimum 8 characters). |
| 31 | `ConfirmPasswordInputLabel` | Form Field Label (`<label>`) | `htmlFor="auth-confirm"`; `block text-xs font-medium text-[var(--color-text)] mb-1.5`; visible text: `"Confirm password "` with red asterisk `<span className="text-[var(--color-danger)]">*</span>`; source: `AuthForm.jsx:311-317`. | Identifies confirm password input requirement. |
| 32 | `ConfirmPasswordInputField` (`#auth-confirm`) | Password Input Field (`type="password"` / `"text"`) | Input element: `w-full h-10 pl-10 pr-10 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] transition-colors focus:outline-none`; placeholder: `"Re-enter password"`; left icon: Lucide `Lock` (`absolute left-3.5 pointer-events-none`); dynamic `type` toggled by `showConfirm`; source: `AuthForm.jsx:318-331`. | Controlled input bound to `formData.confirm`; accepts password re-entry for mismatch verification. |
| 33 | `ConfirmPasswordVisibilityToggle` | Icon Button | Positioned inside confirm password input on the right; `<button type="button" onClick={() => setShowConfirm((v) => !v)} aria-label={showConfirm ? "Hide password" : "Show password"}>`; styling: `absolute right-3 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer`; renders Lucide `Eye` (masked) or `EyeOff` (unmasked); source: `AuthForm.jsx:332-344`. | Toggles confirm password masking between visible cleartext and hidden bullets independently from main password field. |
| 34 | `ConfirmPasswordValidationError` | Validation Error Text (Conditional) | Conditionally rendered below confirm password input when `errors.confirm` is set; `mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1`; Lucide `AlertCircle` (`w-3 h-3`); source: `AuthForm.jsx:345-350`. | Informs user if re-entered password does not match (`"Passwords do not match"`). |
| 35 | `CreateAccountSubmitButton` (`#auth-submit-btn`) | Submit Button | Form submission button: `w-full h-10 rounded-[var(--radius-md)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)] text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2`; idle content: `<span>Create account</span>` + Lucide `ArrowRight`; loading content: Lucide `Loader2` (spinning) + `<span>Creating account...</span>`; source: `AuthForm.jsx:354-374`. | Validates credentials, sets loading state, executes `registerApi`, stores token, and triggers navigation to `/projects`. |
| 36 | `ExistingAccountPrompt` | Mode Switcher Text Container | Footer text below submit button: `mt-5 text-center text-xs text-[var(--color-text-secondary)]`; visible prefix: `"Already have an account? "`; source: `AuthForm.jsx:391-393`. | Contextual prompt directing registered users back to sign-in. |
| 37 | `SignInToggleButton` (`#auth-toggle-to-login`) | Text Action Button | Inline button: `<button type="button" id="auth-toggle-to-login" onClick={onToggleMode}>`; styling: `font-semibold text-[var(--color-primary)] hover:underline cursor-pointer`; visible text: `"Sign in"`; source: `AuthForm.jsx:393-401`. | Toggles `AuthLayout` mode to `"login"`, switching to the Sign In interface in-place. |
| 38 | `SuccessBanner` | Status Alert Card (Conditional) | Conditionally rendered when `status === "success"`; replaces form with `p-4 rounded-[var(--radius-lg)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/30 text-center mb-6`; Lucide `CheckCircle2` (`w-7 h-7 text-[var(--color-success)]`); heading: `"Account created successfully"`; body: `"Redirecting to projects..."`; source: `AuthForm.jsx:144-154`. | Provides visual feedback of successful account registration before automatic redirection. |
| 39 | `AuthFooterNotice` | Footer Disclaimer Text | Positioned at bottom of right panel; `pt-6 border-t border-[var(--color-border)] text-center text-xs text-[var(--color-text-muted)]`; text: `"© {year} CovAI Platform. Protected by isolated test sandbox."`; source: `AuthLayout.jsx:130-135`. | Displays platform copyright and sandbox protection notice. |

---

## 4. Registration and Navigation Flow

### 4.1 Full Name Input
- **State Binding:** Bound to `formData.name` using controlled input handler `update("name")` (`AuthForm.jsx:46-50`).
- **Input Type & Attributes:** `<input id="auth-name" type="text" placeholder="Alex Developer" />`.
- **Validation:** Synchronous evaluation in `validate()` (`AuthForm.jsx:54-56`):
  ```javascript
  if (!isLogin && !formData.name.trim()) {
    errs.name = "Full name is required";
  }
  ```
- **Error Behavior:** If empty upon submission, displays `FullNameValidationError` with Lucide `AlertCircle`. The input border changes to `border-[var(--color-danger)]`. Editing the field immediately clears `errors.name` and any existing `serverMessage`.

### 4.2 Email Address Input
- **State Binding:** Bound to `formData.email` using `update("email")`.
- **Input Type & Attributes:** `<input id="auth-email" type="email" placeholder="alex@company.com" />`.
- **Validation:** Evaluated in `validate()` (`AuthForm.jsx:57-61`):
  ```javascript
  if (!formData.email.trim()) {
    errs.email = "Email address is required";
  } else if (!EMAIL_RE.test(formData.email)) {
    errs.email = "Please enter a valid email address";
  }
  ```
  where `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
- **Duplicate Account Handling:** If the email is already registered in PostgreSQL, the backend throws `"Account already exists!"` (`server/src/services/auth.service.js:9`), returning HTTP 400. The frontend catches this and displays the error in `ServerErrorMessage` above the form.
- **Request Payload:** The email value is included in the JSON payload of `registerApi` (`{ name, email, password }`).

### 4.3 Password Input
- **State Binding:** Bound to `formData.password` using `update("password")`.
- **Input Type & Attributes:** Dynamic input type `<input id="auth-password" type={showPass ? "text" : "password"} placeholder="Minimum 8 characters" />`.
- **Visibility Toggle:** Interactive button with Lucide `Eye` / `EyeOff` toggles `showPass` boolean independently.
- **Validation:** Evaluated in `validate()` (`AuthForm.jsx:62-66`):
  ```javascript
  if (!formData.password) {
    errs.password = "Password is required";
  } else if (formData.password.length < 8) {
    errs.password = "Password must be at least 8 characters";
  }
  ```
- **Backend Hash:** On submission, the backend hashes the password using `bcrypt.hash(password, 10)` (`server/src/services/auth.service.js:11`) before storing it in the `passwordHash` column of table `User`.

### 4.4 Confirm Password Input
- **State Binding:** Bound to `formData.confirm` using `update("confirm")`.
- **Input Type & Attributes:** Dynamic input type `<input id="auth-confirm" type={showConfirm ? "text" : "password"} placeholder="Re-enter password" />`.
- **Visibility Toggle:** Interactive button with Lucide `Eye` / `EyeOff` toggles `showConfirm` boolean independently from `showPass`.
- **Mismatch Validation:** Evaluated in `validate()` (`AuthForm.jsx:67-69`):
  ```javascript
  if (!isLogin && formData.confirm !== formData.password) {
    errs.confirm = "Passwords do not match";
  }
  ```
- **Execution Timing:** Validation runs when the user activates `CreateAccountSubmitButton`. If `confirm` is empty or does not strictly equal `password`, `errors.confirm` is set to `"Passwords do not match"`.
- **Payload Scope:** `formData.confirm` is strictly a client-side verification check and is **not** transmitted to the backend API.

### 4.5 Create Account Submission Flow
1. **Trigger:** User clicks `CreateAccountSubmitButton` (`#auth-submit-btn`) or submits the form via keyboard Enter.
2. **Client Validation:** `handleSubmit(e)` invokes `validate()`. If any of `name`, `email`, `password`, or `confirm` fails validation, `setErrors(errs)` is called, `status` becomes `"error"`, and submission halts.
3. **Loading State:** If valid, `errors` are cleared, `status` is set to `"loading"`, the submit button is disabled, and its label displays `Loader2` spinning icon with `"Creating account..."`.
4. **API Invocation:** `registerApi({ name, email, password })` in `client/src/services/auth.service.js:81-104` dispatches a `POST` request to `${BASE_URL}/auth/register`.
5. **Backend Processing:**
   - Evaluated by `authLimiter` middleware.
   - Parsed by Zod schema `authValid` in `server/src/controllers/auth.controller.js:13-17`.
   - `server/src/services/auth.service.js:7-40` queries `prisma.user.findUnique({ where: { email } })`. If found, throws `"Account already exists!"`.
   - Hashes password via `bcrypt.hash(password, 10)`.
   - Creates new record in Prisma: `prisma.user.create({ data: { email, passwordHash: hashedPass, name } })`.
   - Issues `accessToken` (15m expiry, `JWT_SECRET`) and `refreshToken` (7d expiry, `JWT_REFRESH_SECRET`).
   - Persists `refreshToken` in DB and sets an `httpOnly`, `sameSite: "strict"` cookie named `refreshToken`.
   - Returns HTTP 201 with body `{ message, accessToken, userName, userEmail }`.
6. **Client Response Handling & Immediate Auto-Login:**
   - The frontend executes:
     ```javascript
     localStorage.setItem("token", data.accessToken);
     localStorage.setItem("userName", data.userName);
     localStorage.setItem("userEmail", data.userEmail);
     ```
   - Sets `status` to `"success"`.
   - Replaces form with `SuccessBanner` (`"Account created successfully"`, `"Redirecting to projects..."`).
   - Executes a 1000ms delay (`setTimeout`), followed by full-page navigation:
     ```javascript
     window.location.href = "/projects";
     ```
   - **No Email Verification Requirement:** Registration directly establishes an authenticated session and redirects to the workspace without intermediate email confirmation.

### 4.6 Continue with GitHub
- Triggered by `GithubOAuthButton` (`#auth-github-btn`).
- Calls `handleGithubOAuth()` (`AuthForm.jsx:122-127`), redirecting to `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=user:email repo&redirect_uri=${redirectUri}`.
- If the user has not registered before, the backend OAuth controller (`server/src/controllers/auth.controller.js:268-276`) automatically registers a new user record in PostgreSQL using their GitHub profile and email, signs a JWT token, and logs them in.

### 4.7 Sign In Navigation
- Located in the mode switcher at the bottom of the form (`AuthForm.jsx:393-401`).
- Activating `SignInToggleButton` (`#auth-toggle-to-login`) invokes `onToggleMode`, which executes `toggleMode` in `AuthLayout.jsx:31-32`:
  ```javascript
  setMode((m) => (m === "login" ? "register" : "login"));
  ```
- This toggles `mode` to `"login"` in-place without page reloading, updating the title to `"Sign in to CovAI"`, omitting the Full Name and Confirm Password fields, and displaying the `"Forgot password?"` link.
- Additionally, direct URL navigation to `/login` is supported by React Router (`App.jsx:82-89`).

### 4.8 Back to Home Navigation
- Clicking `BackToHomeLink` (`#auth-back-home`, `"← Back to home"`) in `AuthLayout.jsx:106-113` navigates to root `/` (`LandingPage`).
- Alternatively, clicking the brand logo (`#auth-logo`) on the left panel performs the same navigation to `/`.

### 4.9 Theme Toggle Interaction
- Clicking `ThemeSelectorCompact` (`AuthLayout.jsx:115`) cycles theme state (`light -> dark -> system -> light`).
- Saves selection in `localStorage.setItem("covai_theme", newTheme)` and updates `document.documentElement` attribute `data-theme` and class `dark`.
- Instantly updates all CSS variable tokens across both left and right panels of the Register page.

---

## 5. Validation, Loading, and Error States

The following table documents every implemented validation rule, error trigger, loading indicator, and success condition for the Register interface:

| State / Trigger | UI Presentation | Technical Mechanism | Source Evidence |
|---|---|---|---|
| **Missing Full Name** | Red border on input; red text with `AlertCircle`: `"Full name is required"` | `!isLogin && !formData.name.trim()` detected during `validate()`; sets `errors.name`. | `AuthForm.jsx:54-56, 210-221` |
| **Missing Email Address** | Red border on input; red text with `AlertCircle`: `"Email address is required"` | `!formData.email.trim()` detected during `validate()`; sets `errors.email`. | `AuthForm.jsx:57-59, 241-253` |
| **Invalid Email Format** | Red border on input; red text with `AlertCircle`: `"Please enter a valid email address"` | `!EMAIL_RE.test(formData.email)` failed during `validate()`; sets `errors.email`. | `AuthForm.jsx:59-61, 241-253` |
| **Missing Password** | Red border on input; red text with `AlertCircle`: `"Password is required"` | `!formData.password` detected during `validate()`; sets `errors.password`. | `AuthForm.jsx:62-64, 283-286` |
| **Short Password (< 8 chars)** | Red border on input; red text with `AlertCircle`: `"Password must be at least 8 characters"` | `formData.password.length < 8` failed during `validate()`; sets `errors.password`. | `AuthForm.jsx:64-66, 301-306` |
| **Missing Confirm Password** | Red border on input; red text with `AlertCircle`: `"Passwords do not match"` | `formData.confirm !== formData.password` (empty confirm does not equal password); sets `errors.confirm`. | `AuthForm.jsx:67-69, 328-350` |
| **Password Mismatch** | Red border on input; red text with `AlertCircle`: `"Passwords do not match"` | `formData.confirm !== formData.password` detected during `validate()`; sets `errors.confirm`. | `AuthForm.jsx:67-69, 328-350` |
| **Duplicate Account (Email Exists)** | Red alert banner above form: `AlertCircle` icon + `"Account already exists!"` | Backend returns HTTP 400 with `{ message: "Account already exists!" }`; caught and stored in `serverMessage`. | `server/src/services/auth.service.js:9`, `AuthForm.jsx:114-118, 177-183` |
| **Backend Zod Field Errors** | Corresponding input borders turn red; inline error messages appear below respective fields | Backend `authValid` returns `{ error: { field: [msg] } }`; `registerApi` throws `{ type: "field", errors }`; mapped to `setErrors(err.errors)`. | `server/src/validators/auth.validation.js:3-10`, `client/src/services/auth.service.js:92-97`, `AuthForm.jsx:112-114` |
| **Form Submitting (Loading)** | Submit button displays spinning `Loader2` and text `"Creating account..."`; button is disabled with `opacity-50 cursor-not-allowed`. Inputs remain interactive. | `status === "loading"`; `disabled={status === "loading"}` on `#auth-submit-btn`. | `AuthForm.jsx:85, 357-366` |
| **Registration API / Network Failure** | Red alert banner above form: `AlertCircle` icon + error message (e.g., `"Authentication failed. Please verify credentials."`) | Catch block handles unexpected error or HTTP 500; sets `serverMessage`. | `AuthForm.jsx:115-117, 177-183` |
| **Successful Registration** | Form unmounts; green card appears with `CheckCircle2` icon, `"Account created successfully"`, and `"Redirecting to projects..."` | `status === "success"`; auto-login tokens saved; 1000ms timer triggers redirect to `/projects`. | `AuthForm.jsx:106-109, 144-154` |
| **Account Verification / Activation** | None. No verification email banner or code confirmation step is rendered. | Account is activated immediately upon creation; session tokens are issued in HTTP 201 response. | Verified from `server/src/controllers/auth.controller.js:20-32` and `AuthForm.jsx:102-109`. |
| **Active Session Route Guard** | User visiting `/register` while already authenticated is redirected immediately to `/projects`. | `RedirectIfAuthenticated` checks `localStorage.getItem("token")`; returns `<Navigate to="/projects" replace />`. | `client/src/App.jsx:54-65, 91-96` |

---

## 6. Screenshot-to-Code Comparison

The following table compares each visual element described in the Register screenshot reference against the actual source-code implementation:

| UI Element | Screenshot Observation | Source-Code Evidence | Status | Notes |
|---|---|---|---|---|
| **COVAI Logo & Version** | Purple rounded square with `>_` terminal glyph, text `"CovAI"`, and pill badge `"v2.4"` in top left of left panel. | Implemented via `<Link to="/" id="auth-logo">`, Lucide `Terminal`, and styled `v2.4` span in `AuthLayout.jsx:42-58`. | **MATCH** | Exact match in styling, icon choice, badge dimensions, and text. |
| **Left Panel Heading** | `"Automated Test Coverage & Deterministic Branch Verification"` in bold heading. | Text in `<h2>` element inside `AuthLayout.jsx:64-66`. | **MATCH** | Exact text and visual hierarchy match. |
| **Left Panel Description** | Descriptive paragraph explaining synthesized unit tests, CFG branch detection, and sandbox runner. | Text in `<p>` element inside `AuthLayout.jsx:67-71`. | **MATCH** | Exact 1:1 wording match. |
| **Code Window Header** | macOS 3 window dots (red, yellow, green), label `tests / checkout.test.js`, and green badge `CheckCircle2` + `Jest 29.0 Pass`. | Implemented in `CodePreview.jsx:173-189` with Lucide `CheckCircle2`. | **MATCH** | Exact layout and iconography match. |
| **Code Preview Syntax Body** | 15 lines of mock test code for `checkout()`; lines 7 & 8 highlighted with purple tint, left border, and green checkmark `✓`. | Implemented in `CodePreview.jsx:3-148, 191-222`. Lines 7 and 8 have `highlight: true`. | **MATCH** | Static demonstrative preview; exact tokenization, colors, checkmark markers, and code contents match. |
| **Code Window Status Bar** | Bottom bar: `Covered branch: Line 14 (throw new Error)`, `100% Branch`, `14ms`. | Implemented in `CodePreview.jsx:225-236` with Lucide `Terminal`. | **MATCH** | Exact match in wording, badges, and layout. |
| **Platform Pillars** | Three cards at bottom of left panel: "Control Flow", "Test Synthesis", "Sandbox Runner". | Rendered from `ARCHITECTURE_PILLARS` array in `AuthLayout.jsx:10-26, 79-97` with `GitBranch`, `Cpu`, `ShieldCheck`. | **MATCH** | Exact match in icon selection, card background, and titles. |
| **Back to Home Link** | Top left of right panel: arrow left icon with text `"Back to home"`. | Implemented via `<Link to="/" id="auth-back-home">` with Lucide `ArrowLeft` in `AuthLayout.jsx:106-113`. | **MATCH** | Exact match in icon, label, and navigation target (`/`). |
| **Theme Toggle Button** | Top right of right panel: square button displaying theme icon. | Rendered by `<ThemeSelector compact />` in `AuthLayout.jsx:115` & `ThemeSelector.jsx:20-30`. Renders `Sun` in light mode, `Moon` in dark mode, `Monitor` in system mode. | **MATCH** | Visual icon matches because the screenshot was captured in active light mode. |
| **Register Heading & Subtitle** | Heading `"Create developer account"` and subtitle `"Automate test generation and branch coverage in minutes."`. | Rendered in `AuthForm.jsx:133-140` when `isLogin === false`. | **MATCH** | Exact wording match. |
| **Continue with GitHub Button** | Full-width button with GitHub mark and label `"Continue with GitHub"`. | Implemented via `<button id="auth-github-btn">` with SVG GitHub icon in `AuthForm.jsx:159-167`. | **MATCH** | Exact match in label and styling. |
| **Email Divider** | Horizontal divider with centered text `"or continue with email"`. | Implemented via relative divider container in `AuthForm.jsx:169-175`. | **MATCH** | Exact visual match. |
| **Full Name Input Field** | Input labeled `"Full name *"` with user icon and placeholder `"Alex Developer"`. | Implemented in `AuthForm.jsx:193-223` with label `"Full name *"`, icon `User`, placeholder `"Alex Developer"`. | **MATCH** | Exact match in label, icon, and placeholder. |
| **Email Address Input Field** | Input labeled `"Email address *"` with mail icon and placeholder `"alex@company.com"`. | Implemented in `AuthForm.jsx:225-254` with label `"Email address *"`, icon `Mail`, placeholder `"alex@company.com"`. | **MATCH** | Exact match in label, icon, and placeholder. |
| **Password Input Field** | Input labeled `"Password *"` with lock icon, placeholder `"Minimum 8 characters"`, and eye visibility toggle. | Implemented in `AuthForm.jsx:256-307`. In register mode, placeholder is `"Minimum 8 characters"`, icon is `Lock`, toggle is `Eye`/`EyeOff`. | **MATCH** | Exact visual match. Note: "Forgot password?" is omitted in register mode. |
| **Confirm Password Input Field** | Input labeled `"Confirm password *"` with lock icon, placeholder `"Re-enter password"`, and eye visibility toggle. | Implemented in `AuthForm.jsx:309-352` with label `"Confirm password *"`, icon `Lock`, placeholder `"Re-enter password"`, toggle `Eye`/`EyeOff`. | **MATCH** | Exact visual match. Has independent visibility toggle state `showConfirm`. |
| **Create Account Button** | Purple button with label `"Create Account →"`. | Implemented in `AuthForm.jsx:354-374` with `bg-[var(--color-primary)]`, text `<span>Create account</span>`, and Lucide `ArrowRight`. | **PARTIAL MATCH** | **Label casing discrepancy:** Source code renders sentence case `"Create account"` (`AuthForm.jsx:369`), whereas UI specifications frequently display Title Case `"Create Account"`. The right arrow is Lucide `ArrowRight`. |
| **Existing-Account Prompt & Link** | Bottom prompt: `"Already have an account? Sign in"`. | Rendered in `AuthForm.jsx:391-402` via text and button `#auth-toggle-to-login`. | **MATCH** | Exact wording and styling match. |
| **Footer Sandbox Notice** | Not clearly visible or cropped out at bottom of screenshot. | Implemented in `AuthLayout.jsx:130-135` (`"© {year} CovAI Platform. Protected by isolated test sandbox."`). | **MATCH** (Cropped in screenshot) | The divider border is faintly visible at the bottom cut line; element exists in DOM. |

---

## 7. Findings and Limitations

### 7.1 Verified Functionality
1. **Unified Auth Layout Engine:** The Register page (`/register`) shares the same `AuthLayout` component as the Sign In page (`/login`), ensuring 100% visual and token consistency across all authentication views.
2. **Independent Password Visibility Controls:** The `PasswordInputField` and `ConfirmPasswordInputField` maintain independent visibility state hooks (`showPass` and `showConfirm`), allowing users to toggle masking for either field independently.
3. **Multi-layer Validation Pipeline:**
   - **Frontend:** Instant required-field checks (`name`, `email`, `password`), regex email validation, minimum 8-character password length check, and confirm password matching check.
   - **Backend:** Zod schema validation (`authValid`) enforcing string constraints (name 1–100 chars, valid email, password $\ge 8$ chars).
4. **Seamless Auto-Login Onboarding:** Upon successful registration, the backend returns both an access token and refresh token. The frontend stores user credentials in `localStorage` and immediately transitions the user into the active workspace (`/projects`), removing friction from the developer onboarding experience.
5. **No Account Activation Friction:** The platform does not require email confirmation, activation links, or SMS OTPs before granting workspace access.

### 7.2 Incomplete Behaviors and Implementation Gaps
1. **Submit Button Text Casing:**
   - **Observed / Specified:** `"Create Account →"` (Title Case).
   - **Source Code (`AuthForm.jsx:369`):** Renders sentence case: `<span>{isLogin ? "Sign in" : "Create account"}</span>`.
2. **Session Storage Key Discrepancy:**
   - In `AuthForm.jsx:102-104`, registration sets `localStorage.setItem("token", data.accessToken)`, `localStorage.setItem("userName", data.userName)`, and `localStorage.setItem("userEmail", data.userEmail)`.
   - However, unlike `GithubCallbackPage.jsx:37`, it does **not** store the serialized `user` JSON object (`localStorage.setItem("user", JSON.stringify(userPayload))`). While route guards check `localStorage.getItem("token")` first and pass successfully, downstream components that query `localStorage.getItem("user")` directly may encounter null references until refreshed.
3. **Client-Side Only Confirm Password:**
   - Confirm password validation occurs purely in `validate()`. `formData.confirm` is excluded from the HTTP POST payload dispatched to `POST /api/auth/register`.
4. **Desktop-Only Technical Showcase:**
   - The left technical showcase is hidden (`hidden lg:flex`) on screens narrower than 1024px, ensuring mobile users only see the registration form.

### 7.3 Limitations of Static Analysis
- **Live Third-Party OAuth Handshake:** The redirection to GitHub OAuth and subsequent authorization exchange in `oAuthGithub` depend on valid external OAuth App credentials (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`) and cannot be executed end-to-end in offline static analysis.
- **Database Unique Constraints:** Prisma user insertion was verified against schema definitions; runtime database constraints were not subjected to live collision testing during this analysis.

---

## 8. Source References

The following exact file paths and source code locations provide evidence for every finding documented in this analysis:

1. **`client/src/pages/RegisterPage.jsx`**
   - `RegisterPage`: [Lines 1–5](file:///d:/NCKH/CovAI-/client/src/pages/RegisterPage.jsx#L1-L5)
2. **`client/src/components/auth/AuthLayout.jsx`**
   - Architectural Pillars Array: [Lines 10–26](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L10-L26)
   - Layout Grid & Mode State: [Lines 28–35](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L28-L35)
   - Left Panel Branding & Showcase: [Lines 39–98](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L39-L98)
   - Right Panel Header (`#auth-back-home`, `<ThemeSelector />`): [Lines 105–116](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L105-L116)
   - Form Container Integration: [Lines 119–127](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L119-L127)
   - Footer Sandbox Notice: [Lines 130–135](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L130-L135)
3. **`client/src/components/auth/AuthForm.jsx`**
   - Form State Hooks (`formData`, `errors`, `showPass`, `showConfirm`): [Lines 31–45](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L31-L45)
   - Controlled Input Update Handler: [Lines 46–50](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L46-L50)
   - Synchronous Validation Function: [Lines 52–71](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L52-L71)
   - Submit Handler & Auto-Login Logic: [Lines 73–120](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L73-L120)
   - GitHub OAuth Trigger: [Lines 122–127](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L122-L127)
   - Form Heading & Description: [Lines 132–141](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L132-L141)
   - Success State Card: [Lines 144–154](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L144-L154)
   - GitHub OAuth Button: [Lines 159–167](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L159-L167)
   - Full Name Input Group: [Lines 193–223](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L193-L223)
   - Email Input Group: [Lines 225–254](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L225-L254)
   - Password Input Group: [Lines 256–307](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L256-L307)
   - Confirm Password Input Group: [Lines 309–352](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L309-L352)
   - Submit Button with Loading Indicator: [Lines 354–374](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L354-L374)
   - Mode Switcher Prompt & Button: [Lines 376–404](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L376-L404)
4. **`client/src/components/auth/CodePreview.jsx`**
   - Mock Test AST Token Dataset: [Lines 3–148](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L3-L148)
   - Syntax Highlighting Formatter: [Lines 151–168](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L151-L168)
   - Title Bar & Status Elements: [Lines 172–189](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L172-L189)
   - Editor Body & Gutter Checkmarks: [Lines 191–222](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L191-L222)
   - Execution Metrics Status Bar: [Lines 225–236](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L225-L236)
5. **`client/src/components/common/ThemeSelector.jsx`**
   - Compact Theme Button: [Lines 13–31](file:///d:/NCKH/CovAI-/client/src/components/common/ThemeSelector.jsx#L13-L31)
6. **`client/src/contexts/ThemeContext.jsx`**
   - Theme Provider & DOM Root Configuration: [Lines 9–64](file:///d:/NCKH/CovAI-/client/src/contexts/ThemeContext.jsx#L9-L64)
7. **`client/src/services/auth.service.js`**
   - `registerApi`: [Lines 81–104](file:///d:/NCKH/CovAI-/client/src/services/auth.service.js#L81-L104)
   - `oAuthGithubApi`: [Lines 138–147](file:///d:/NCKH/CovAI-/client/src/services/auth.service.js#L138-L147)
8. **`server/src/routes/auth.route.js`**
   - Registration Route Binding: [Line 19](file:///d:/NCKH/CovAI-/server/src/routes/auth.route.js#L19)
9. **`server/src/controllers/auth.controller.js`**
   - `register`: [Lines 11–40](file:///d:/NCKH/CovAI-/server/src/controllers/auth.controller.js#L11-L40)
10. **`server/src/validators/auth.validation.js`**
    - `authValid` Zod Schema: [Lines 3–10](file:///d:/NCKH/CovAI-/server/src/validators/auth.validation.js#L3-L10)
11. **`server/src/services/auth.service.js`**
    - User Registration Service & Password Hashing: [Lines 7–40](file:///d:/NCKH/CovAI-/server/src/services/auth.service.js#L7-L40)

---

## 9. Final UI Specification Table

The following clean table is standardized for inclusion in the formal COVAI Capstone Project UI Design Specification report:

| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `BrandLogoContainer` | Text Link / Brand Logo | Top-left of left panel; brand icon with terminal symbol `>_`, title `"CovAI"`, and version badge `"v2.4"` | Navigates to Landing Page (`/`) |
| 2 | `BrandIcon` | Icon Container | Purple square badge (`bg-[var(--color-primary)]`) with white Lucide `Terminal` icon | Visual brand representation |
| 3 | `BrandTitle` | Text (Brand Name) | Text: `"CovAI"`; bold typography | Displays platform name |
| 4 | `VersionBadge` | Version Badge | Text: `"v2.4"`; bordered pill badge | Displays platform version |
| 5 | `LeftPanelHeading` | Text Heading (`<h2>`) | Text: `"Automated Test Coverage & Deterministic Branch Verification"` | Primary showcase headline |
| 6 | `LeftPanelDescription` | Descriptive Text (`<p>`) | Text: `"CovAI synthesizes targeted unit test suites, detects missing logic paths in your Control Flow Graphs, and executes tests in a secure sandbox."` | Summary of core capabilities |
| 7 | `CodePreviewContainer` | Code Preview Component | Card container with border, surface background, and JetBrains Mono code typography | Visual code and test demonstration |
| 8 | `CodePreviewTitleBar` | Window Header Bar | macOS 3 window control circles, label `"tests / checkout.test.js"`, and `"Jest 29.0 Pass"` badge | Shows test file name and runner status |
| 9 | `CodePreviewEditor` | Code Display Area | 15 lines of mock test code with line numbers, syntax highlighting, and checkmarks on lines 7–8 | Demonstrates synthesized test case assertions |
| 10 | `CodePreviewStatusBar` | Execution Status Bar | Terminal icon with `"Covered branch: Line 14 (throw new Error)"`, `"100% Branch"`, and `"14ms"` | Displays branch verification metrics |
| 11 | `PillarControlFlow` | Feature Card | Card with `GitBranch` icon, title `"Control Flow"`, description `"AST branch graph"` | Architectural pillar display |
| 12 | `PillarTestSynthesis` | Feature Card | Card with `Cpu` icon, title `"Test Synthesis"`, description `"Targeted Jest suites"` | Architectural pillar display |
| 13 | `PillarSandboxRunner` | Feature Card | Card with `ShieldCheck` icon, title `"Sandbox Runner"`, description `"Isolated execution"` | Architectural pillar display |
| 14 | `BackToHomeLink` | Navigation Text Link | Top-left of right panel; `ArrowLeft` icon + text `"Back to home"` | Navigates to Landing Page (`/`) |
| 15 | `ThemeSelectorCompact` | Icon Button | Top-right of right panel; compact icon button rendering active theme icon (`Sun`, `Moon`, or `Monitor`) | Cycles theme: light -> dark -> system |
| 16 | `RegisterFormHeading` | Text Heading (`<h1>`) | Text: `"Create developer account"` | Screen title |
| 17 | `RegisterFormDescription` | Descriptive Text (`<p>`) | Text: `"Automate test generation and branch coverage in minutes."` | Instructions for developer onboarding |
| 18 | `GithubOAuthButton` | Action Button | Button with GitHub logo and text `"Continue with GitHub"` | Redirects to GitHub OAuth authorization |
| 19 | `EmailDivider` | Text Separator | Horizontal line with text `"or continue with email"` | Separates OAuth from email registration |
| 20 | `ServerErrorMessage` | Alert Banner | Conditionally rendered red alert box with `AlertCircle` icon and server error text | Informs user of registration failure |
| 21 | `FullNameInputLabel` | Field Label (`<label>`) | Text: `"Full name *"` | Identifies full name input field |
| 22 | `FullNameInputField` | Input Field (`type="text"`) | User icon on left, placeholder `"Alex Developer"`, bound to `formData.name` | Accepts user full name |
| 23 | `FullNameValidationError` | Validation Message | Conditionally rendered red error text with `AlertCircle` icon below full name input | Informs user of missing full name |
| 24 | `EmailInputLabel` | Field Label (`<label>`) | Text: `"Email address *"` | Identifies email input field |
| 25 | `EmailInputField` | Input Field (`type="email"`) | Mail icon on left, placeholder `"alex@company.com"`, bound to `formData.email` | Accepts user email address |
| 26 | `EmailValidationError` | Validation Message | Conditionally rendered red error text with `AlertCircle` icon below email input | Informs user of missing or malformed email |
| 27 | `PasswordInputLabel` | Field Label (`<label>`) | Text: `"Password *"` | Identifies password input field |
| 28 | `PasswordInputField` | Password Input (`type="password"` / `"text"`) | Lock icon on left, placeholder `"Minimum 8 characters"`, dynamic masking bound to `formData.password` | Accepts user password |
| 29 | `PasswordVisibilityToggle` | Icon Button | Eye icon (`Eye` / `EyeOff`) positioned inside right of password input | Toggles password visibility |
| 30 | `PasswordValidationError` | Validation Message | Conditionally rendered red error text with `AlertCircle` icon below password input | Informs user of password requirement |
| 31 | `ConfirmPasswordInputLabel` | Field Label (`<label>`) | Text: `"Confirm password *"` | Identifies confirm password input field |
| 32 | `ConfirmPasswordInputField` | Password Input (`type="password"` / `"text"`) | Lock icon on left, placeholder `"Re-enter password"`, dynamic masking bound to `formData.confirm` | Accepts password re-entry |
| 33 | `ConfirmPasswordVisibilityToggle` | Icon Button | Eye icon (`Eye` / `EyeOff`) positioned inside right of confirm password input | Toggles confirm password visibility |
| 34 | `ConfirmPasswordValidationError` | Validation Message | Conditionally rendered red error text with `AlertCircle` icon below confirm password input | Informs user of password mismatch |
| 35 | `CreateAccountSubmitButton` | Submit Button | Purple button with text `"Create account"` and right arrow icon; shows `"Creating account..."` when loading | Submits credentials to `POST /api/auth/register` |
| 36 | `ExistingAccountPrompt` | Text Container | Text: `"Already have an account? "` | Prompt leading back to sign in |
| 37 | `SignInToggleButton` | Text Action Button | Text: `"Sign in"` with primary styling | Toggles form to Sign In mode |
| 38 | `SuccessBanner` | Status Card | Green card with `CheckCircle2` icon, `"Account created successfully"`, `"Redirecting to projects..."` | Confirms successful registration before redirect |
| 39 | `AuthFooterNotice` | Footer Text | Bottom text: `"© {year} CovAI Platform. Protected by isolated test sandbox."` | Displays platform copyright and notice |
