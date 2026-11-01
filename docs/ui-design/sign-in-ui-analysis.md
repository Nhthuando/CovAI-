# COVAI Sign In UI — Implementation Analysis

## 1. Overview

The **Sign In interface** is the primary authentication gateway of the COVAI platform (`/login`). Its purpose is to authenticate registered software engineers and developers, establish authenticated application sessions, and grant access to the protected project workspace (`/projects`) and test execution dashboard (`/main-editor`).

The interface employs a split two-column responsive layout:
1. **Left Panel (Technical Showcase):** A desktop-only (`hidden lg:flex`) branding and feature-demonstration pane. It features the COVAI logo, version identifier (`v2.4`), value proposition heading, a simulated syntax-highlighted Jest test suite preview demonstrating deterministic branch coverage (`tests/checkout.test.js`), and three core architectural pillars (Control Flow, Test Synthesis, and Sandbox Runner).
2. **Right Panel (Authentication Container):** A focused form column providing dual authentication pathways:
   - **GitHub OAuth 2.0:** Single-click external developer authentication.
   - **Email and Password Authentication:** Direct credential submission with client-side format validation, inline error messaging, password visibility toggle, password reset trigger, and transition to account registration.
   - **Global Utilities:** A top navigation bar containing a return link to the landing page (`/`) and a compact theme toggle cycling between light, dark, and system themes.

The application is built with **React 19**, **Vite**, **React Router v7**, and styled with **Tailwind CSS v4** utilizing strict CSS variable tokens defined in `client/src/index.css`.

---

## 2. Implementation Files

The following table documents all frontend and backend source files responsible for the Sign In interface and its underlying authentication pipeline:

| File path | Component/function | Responsibility | Evidence |
|---|---|---|---|
| `client/src/pages/LoginPage.jsx` | `LoginPage` | Page-level route component mounting `AuthLayout` in default `"login"` mode. | Lines 1–5: `export default function LoginPage() { return <AuthLayout />; }` |
| `client/src/components/auth/AuthLayout.jsx` | `AuthLayout` | Primary 2-column layout container; manages mode switching (`login`, `register`, `forgot_password`, `reset_password`), renders technical showcase (left) and form wrapper (right). | Lines 28–139: Grid container, `ARCHITECTURE_PILLARS` mapping, `#auth-logo`, `#auth-back-home`, `<ThemeSelector compact />`, `<CodePreview />`, conditional form rendering. |
| `client/src/components/auth/AuthForm.jsx` | `AuthForm` | Interactive authentication form handling email/password inputs, client-side validation, submit handling, GitHub OAuth trigger, loading/error states, and mode toggling. | Lines 31–408: Input state hooks, `validate()`, `handleSubmit()`, `handleGithubOAuth()`, `#auth-github-btn`, `#auth-submit-btn`, `#auth-toggle-to-register`. |
| `client/src/components/auth/CodePreview.jsx` | `CodePreview` | Syntax-highlighted mock IDE/test runner card displaying Jest 29.0 execution, covered branch indicators, execution duration, and pass status. | Lines 1–239: Static tokenized code representation of `tests/checkout.test.js`, macOS-style title bar controls, line gutter checkmarks, branch execution status bar. |
| `client/src/components/auth/ForgotPasswordForm.jsx` | `ForgotPasswordForm` | Swappable sub-view allowing users to request a password reset email without leaving the auth page. | Lines 14–145: Email input, validation, `forgotPasswordApi` submission, success card with return button (`setMode("login")`). |
| `client/src/components/common/ThemeSelector.jsx` | `ThemeSelector` | Global theme switcher; in `compact` mode, cycles between light, dark, and system schemes. | Lines 4–31: Compact button cycling `light -> dark -> system`, renders `Sun`, `Moon`, or `Monitor` based on resolved theme. |
| `client/src/contexts/ThemeContext.jsx` | `ThemeProvider`, `useTheme` | Context provider managing theme state, `localStorage` key `covai_theme`, and `document.documentElement` attributes (`data-theme`, class `dark`). | Lines 9–72: Syncs state with DOM root and system media query `(prefers-color-scheme: dark)`. |
| `client/src/services/auth.service.js` | `loginApi`, `oAuthGithubApi`, `forgotPasswordApi` | Frontend HTTP client wrapper executing API calls to backend endpoints via `fetchWithAuth`. | Lines 113–164: Calls `POST /api/auth/login`, `GET /api/auth/github/callback`, `POST /api/auth/forgotPassword`. |
| `client/src/pages/GithubCallbackPage.jsx` | `GithubCallbackPage` | OAuth callback consumer handling redirect from GitHub, exchanging authorization code for session tokens. | Lines 6–59: Reads `?code=` and `?error=`, invokes `oAuthGithubApi()`, sets `localStorage`, navigates to `/projects`. |
| `client/src/App.jsx` | `AppContent`, `RedirectIfAuthenticated`, `ProtectedRoute` | Route configuration and authentication routing guards based on `localStorage` token. | Lines 54–65, 82–89: Wraps `/login` in `RedirectIfAuthenticated` which redirects active sessions to `/projects`. |
| `client/src/hooks/useAuth.js` | `useAuth` | Custom hook decoding JWT payload from `localStorage`, exposing user identity and session management functions. | Lines 3–70: `loadUserFromStorage()`, `login()`, `logout()`, `isAuthenticated`. |
| `server/src/routes/auth.route.js` | Express Router | Backend authentication routes defining endpoints and middleware bindings. | Lines 18–28: `router.post("/login", authLimiter, login)`, `router.get("/github/callback", oAuthGithub)`. |
| `server/src/controllers/auth.controller.js` | `login`, `oAuthGithub` | Backend controller handling credential verification, password hashing checks, token issuance, and OAuth token exchange. | Lines 42–74 (`login`), Lines 167–292 (`oAuthGithub`). |
| `server/src/validators/auth.validation.js` | `loginValid` | Backend Zod validation schema enforcing email format and minimum password length. | Lines 12–15: `z.object({ email: z.email(), password: z.string().min(8) })`. |
| `server/src/services/auth.service.js` | `login` (backend service) | Database user lookup via Prisma, bcrypt password verification, and JWT generation (access token: 15m, refresh token: 7d). | Lines 42–73: `prisma.user.findUnique`, `bcrypt.compare`, `jwt.sign`. |

---

## 3. UI Specification

The following five-column specification table details all confirmed UI elements of the COVAI Sign In interface, separating visible requirements and styling from code-verified targets and behaviors.

| No. | Field name | Type | Require | Target |
|---|---|---|---|---|
| 1 | `BrandLogoContainer` (`#auth-logo`) | Text Link / Logo Anchor | Top-left of left panel; flex container with focus outline (`focus-visible:outline-[var(--color-focus)]`); contains brand icon, title, and version tag; source: `AuthLayout.jsx:42-58`. | Navigates user back to landing page (`/`) via React Router `Link`. |
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
| 14 | `BackToHomeLink` (`#auth-back-home`) | Navigation Text Link | Top-left of right panel; `inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)]`; contains Lucide `ArrowLeft` (`w-3.5 h-3.5`) + text `"Back to home"`; source: `AuthLayout.jsx:106-113`. | Navigates user back to landing page (`/`) via React Router `Link`. |
| 15 | `ThemeSelectorCompact` | Icon Button | Top-right of right panel; `w-8 h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]`; renders active theme icon (`Sun`, `Moon`, or `Monitor`); tooltip: `Theme: ${theme} (Click to switch to ${nextTheme})`; source: `AuthLayout.jsx:115`, `ThemeSelector.jsx:13-31`. | Cycles theme mode in sequence: `light -> dark -> system -> light`; persists choice in `localStorage` key `covai_theme` and toggles root CSS tokens. |
| 16 | `AuthFormHeading` | Text Heading (`<h1>`) | Top of auth card; visible text in login mode: `"Sign in to CovAI"`; styling: `text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-text)] mb-1.5`; source: `AuthForm.jsx:133-135`. | Establishes screen context for user credential entry. |
| 17 | `AuthFormDescription` | Descriptive Text (`<p>`) | Visible text in login mode: `"Enter your credentials to access your projects and test dashboards."`; styling: `text-xs sm:text-sm text-[var(--color-text-secondary)] leading-relaxed`; source: `AuthForm.jsx:136-140`. | Instructions detailing destination upon successful login. |
| 18 | `GithubOAuthButton` (`#auth-github-btn`) | Action Button | `w-full h-10 px-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] text-sm font-medium transition-colors flex items-center justify-center gap-2.5`; contains GitHub SVG mark + text `"Continue with GitHub"`; source: `AuthForm.jsx:159-167`. | Triggers `handleGithubOAuth()`; redirects browser to `https://github.com/login/oauth/authorize` with scopes `user:email repo`. |
| 19 | `EmailDivider` | Decorative Text Separator | Relative container with horizontal rule `border-t border-[var(--color-border)] w-full` and centered label `<span className="bg-[var(--color-bg)] px-3 text-[11px] font-normal text-[var(--color-text-muted)] absolute">or continue with email</span>`; source: `AuthForm.jsx:169-175`. | Visually separates OAuth from standard email/password authentication. |
| 20 | `ServerErrorMessage` | Alert Banner (Conditional) | Conditionally rendered when `serverMessage` is not empty; `p-3 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 flex items-start gap-2 mb-4 text-xs text-[var(--color-danger)]`; Lucide `AlertCircle` icon; source: `AuthForm.jsx:177-183`. | Displays backend error response message (e.g., `"Incorrect email or password!"` or `"Authentication failed. Please verify credentials."`). |
| 21 | `EmailInputLabel` | Form Field Label (`<label>`) | `htmlFor="auth-email"`; `block text-xs font-medium text-[var(--color-text)] mb-1.5`; visible text: `"Email address "` with red asterisk `<span className="text-[var(--color-danger)]">*</span>`; source: `AuthForm.jsx:226-232`. | Identifies email input requirement. |
| 22 | `EmailInputField` (`#auth-email`) | Input Field (`type="email"`) | Input element: `w-full h-10 pl-10 pr-3.5 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)]`; placeholder: `"alex@company.com"`; left icon: Lucide `Mail` (`w-4 h-4 text-[var(--color-text-muted)] absolute left-3.5`); source: `AuthForm.jsx:233-247`. | Controlled input bound to `formData.email`; accepts user email address. |
| 23 | `EmailValidationError` | Validation Error Text (Conditional) | Conditionally rendered below email input when `errors.email` is set; `mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1`; Lucide `AlertCircle` (`w-3 h-3`); source: `AuthForm.jsx:248-253`. | Informs user of invalid email or empty required field before submission. |
| 24 | `PasswordInputLabel` | Form Field Label (`<label>`) | `htmlFor="auth-password"`; `block text-xs font-medium text-[var(--color-text)]`; visible text: `"Password "` with red asterisk `<span className="text-[var(--color-danger)]">*</span>`; source: `AuthForm.jsx:258-263`. | Identifies password input requirement. |
| 25 | `ForgotPasswordLink` | Action Button / Link | Positioned right-aligned within password label header; `<button type="button" onClick={() => setMode("forgot_password")}>`; styling: `text-xs text-[var(--color-primary)] hover:underline cursor-pointer`; visible text: `"Forgot password?"`; source: `AuthForm.jsx:265-272`. | Switches `AuthLayout` mode to `"forgot_password"` to present the password recovery sub-view. |
| 26 | `PasswordInputField` (`#auth-password`) | Password Input Field (`type="password"` / `"text"`) | Input element: `w-full h-10 pl-10 pr-10 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm`; placeholder: `"••••••••"`; left icon: Lucide `Lock` (`absolute left-3.5`); dynamic `type` toggles between `"password"` and `"text"` based on `showPass`; source: `AuthForm.jsx:274-287`. | Controlled input bound to `formData.password`; accepts secret authentication credentials. |
| 27 | `PasswordVisibilityToggle` | Icon Button | Positioned inside password input on the right; `<button type="button" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? "Hide password" : "Show password"}>`; styling: `absolute right-3 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]`; renders Lucide `Eye` (masked) or `EyeOff` (unmasked); source: `AuthForm.jsx:288-299`. | Toggles password masking between visible cleartext and hidden bullets. |
| 28 | `PasswordValidationError` | Validation Error Text (Conditional) | Conditionally rendered below password input when `errors.password` is set; `mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1`; Lucide `AlertCircle` (`w-3 h-3`); source: `AuthForm.jsx:301-306`. | Displays password validation requirement (e.g., minimum 8 characters). |
| 29 | `SignInSubmitButton` (`#auth-submit-btn`) | Submit Button | Form submission button: `w-full h-10 rounded-[var(--radius-md)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)] text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 shadow-sm`; idle content: `<span>Sign in</span>` + Lucide `ArrowRight`; loading content: Lucide `Loader2` (spinning) + `<span>Signing in...</span>`; source: `AuthForm.jsx:354-374`. | Validates credentials, sets loading state, executes `loginApi`, stores token, and triggers navigation to `/projects`. |
| 30 | `CreateAccountPrompt` | Mode Switcher Text Container | Footer text below submit button: `mt-5 text-center text-xs text-[var(--color-text-secondary)]`; visible prefix: `"Don't have an account? "`; source: `AuthForm.jsx:377-381`. | Contextual prompt leading to account registration. |
| 31 | `CreateAccountToggleButton` (`#auth-toggle-to-register`) | Text Action Button | Inline button: `<button type="button" id="auth-toggle-to-register" onClick={onToggleMode}>`; styling: `font-semibold text-[var(--color-primary)] hover:underline cursor-pointer`; visible text: `"Create account"`; source: `AuthForm.jsx:381-388`. | Toggles `AuthLayout` mode to `"register"`, presenting developer registration inputs. |
| 32 | `SuccessBanner` | Status Alert Card (Conditional) | Conditionally rendered when `status === "success"`; replaces form with `p-4 rounded-[var(--radius-lg)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/30 text-center mb-6`; Lucide `CheckCircle2` (`w-7 h-7 text-[var(--color-success)]`); heading: `"Sign in successful"`; body: `"Redirecting to projects..."`; source: `AuthForm.jsx:144-154`. | Provides visual feedback of successful authentication before automatic redirection. |
| 33 | `AuthFooterNotice` | Footer Disclaimer Text | Positioned at bottom of right panel; `pt-6 border-t border-[var(--color-border)] text-center text-xs text-[var(--color-text-muted)]`; text: `"© {year} CovAI Platform. Protected by isolated test sandbox."`; source: `AuthLayout.jsx:130-135`. | Displays platform copyright and sandbox protection notice. |

---

## 4. Interaction and Authentication Flow

### 4.1 Email and Password Sign In Flow
1. **User Input:**
   - The user enters an email address into `EmailInputField` (`#auth-email`) and a password into `PasswordInputField` (`#auth-password`).
   - Inputs are controlled via the `update(field)` handler in `AuthForm.jsx:46-50`. Modifying a field clears any existing field-specific error and dismisses `serverMessage`.
2. **Form Submission & Client-side Validation:**
   - User clicks `SignInSubmitButton` (`#auth-submit-btn`) or presses Enter inside the form.
   - `handleSubmit(e)` in `AuthForm.jsx:73-120` prevents default form submission.
   - The synchronous `validate()` function (`AuthForm.jsx:52-71`) verifies:
     - Email is non-empty (error: `"Email address is required"`).
     - Email matches regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (error: `"Please enter a valid email address"`).
     - Password is non-empty (error: `"Password is required"`).
     - Password length is $\ge 8$ characters (error: `"Password must be at least 8 characters"`).
   - If validation fails, `errors` are updated, `status` becomes `"error"`, and execution terminates without network activity.
3. **API Dispatch:**
   - If valid, `errors` is reset to `{}` and `status` is set to `"loading"`.
   - The submit button is disabled and displays a spinning `Loader2` with text `"Signing in..."`.
   - `loginApi({ email, password })` in `client/src/services/auth.service.js:113-133` dispatches a `POST` request to `${BASE_URL}/auth/login` (default: `http://localhost:5000/api/auth/login`).
4. **Backend Processing:**
   - The request passes through backend rate limiter `authLimiter` (`server/src/middlewares/rateLimit.middleware.js`).
   - The controller `login` in `server/src/controllers/auth.controller.js:42-74` validates input using Zod schema `loginValid`.
   - Service `login` in `server/src/services/auth.service.js:42-73` queries PostgreSQL using Prisma: `prisma.user.findUnique({ where: { email } })`.
   - Compares the password hash using `bcrypt.compare(password, user.passwordHash)`.
   - If invalid, throws `new Error("Incorrect email or password!")`, returning HTTP 400.
   - If valid, issues an Access Token (JWT, 15m expiry signed with `JWT_SECRET`) and Refresh Token (JWT, 7d expiry signed with `JWT_REFRESH_SECRET`).
   - Persists the refresh token to the database user record, sets an `httpOnly`, `sameSite: "strict"` cookie named `refreshToken`, and returns HTTP 200 with JSON payload `{ message: "Login successful!", accessToken, name, email }`.
5. **Client Response Handling:**
   - **On Success:**
     - The client executes:
       ```javascript
       localStorage.setItem("token", data.accessToken);
       localStorage.setItem("userName", data.name);
       localStorage.setItem("userEmail", data.email);
       ```
     - Sets `status` to `"success"`.
     - Replaces the form with the `SuccessBanner` (`"Sign in successful"`, `"Redirecting to projects..."`).
     - Triggers a 1000ms delay (`setTimeout`), followed by full-page navigation:
       ```javascript
       window.location.href = "/projects";
       ```
   - **On Failure:**
     - Catches error in `AuthForm.jsx:110-119`.
     - Sets `status` to `"error"`.
     - If the error contains Zod field-level errors (`err.type === "field"`), maps them to `errors`.
     - Otherwise, displays `serverMessage`: `err.message || "Authentication failed. Please verify credentials."`.

### 4.2 GitHub OAuth Flow
1. **Trigger:**
   - The user clicks `GithubOAuthButton` (`#auth-github-btn`).
   - Invokes `handleGithubOAuth` (`AuthForm.jsx:122-127`).
2. **Redirection to GitHub:**
   - Obtains Client ID from environment variable `import.meta.env.VITE_GITHUB_CLIENT_ID` with fallback to default `"Ov23liQyAORXbj6NeqAB"`.
   - Computes `redirectUri = "${window.location.origin}/auth/github/callback"`.
   - Navigates via `window.location.href`:
     ```text
     https://github.com/login/oauth/authorize?client_id=${clientId}&scope=user:email repo&redirect_uri=${redirectUri}
     ```
3. **Authorization & Callback:**
   - GitHub prompts developer consent and redirects back to `http://<origin>/auth/github/callback?code=...`.
   - The route mounts `GithubCallbackPage.jsx`.
   - If `error === "access_denied"`, an alert displays `"You declined GitHub access permission."` and redirects to `/login`.
   - If `code` exists, it replaces browser history to scrub the code parameter, and invokes `oAuthGithubApi(code)` (`services/auth.service.js:138-147`), calling backend `GET /api/auth/github/callback?code=...`.
4. **Backend OAuth Token Exchange:**
   - `server/src/controllers/auth.controller.js:167-292` posts to `https://github.com/login/oauth/access_token` using `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
   - Queries `https://api.github.com/user` and `https://api.github.com/user/emails` to resolve primary email.
   - Encrypts GitHub access token via `encrypt(accessToken)` (`server/src/utils/crypto.js`) and upserts user record in Prisma.
   - Signs application JWT containing `userId`, `userEmail`, `userName`.
   - Returns `{ message: "GitHub login successful!", token, name, email }`.
5. **Client Completion:**
   - `GithubCallbackPage.jsx:36-41` stores `token`, `user`, `userName`, and `userEmail` in `localStorage` and navigates to `/projects`.

### 4.3 Forgot Password Navigation
1. The user clicks `ForgotPasswordLink` (`"Forgot password?"`) inside `AuthForm.jsx:265-272`.
2. The click handler executes `setMode("forgot_password")`.
3. In `AuthLayout.jsx:120-122`, the condition `mode === "forgot_password"` evaluates to true.
4. `AuthForm` unmounts and `<ForgotPasswordForm setMode={setMode} />` mounts in-place within the right panel. No page reload or route navigation occurs.
5. In `ForgotPasswordForm.jsx`, user submits email to `POST /api/auth/forgotPassword`. On success, a confirmation card appears with button `"Return to Sign In"`, which executes `setMode("login")` to return to the Sign In interface.

### 4.4 Create Account Navigation
1. **In-place Mode Toggle:**
   - The user clicks `CreateAccountToggleButton` (`#auth-toggle-to-register`, `"Create account"`).
   - Invokes `onToggleMode` which executes `toggleMode` in `AuthLayout.jsx:31-32`: `setMode((m) => (m === "login" ? "register" : "login"))`.
   - Switches `mode` to `"register"`. `AuthForm` re-renders with:
     - Heading: `"Create developer account"`.
     - Subtitle: `"Automate test generation and branch coverage in minutes."`.
     - Additional fields: `"Full name *"` (`#auth-name`) and `"Confirm password *"` (`#auth-confirm`).
     - Submit button: `"Create account"`.
     - Footer prompt: `"Already have an account? Sign in"`.
2. **Direct Route Access:**
   - React Router also defines a dedicated route `/register` (`App.jsx:91-97`) mounting `<RegisterPage />`, which initializes `<AuthLayout initialMode="register" />`.

### 4.5 Back to Home Navigation
1. The user clicks `BackToHomeLink` (`#auth-back-home`, `"← Back to home"`).
2. React Router's `<Link to="/">` catches the click and navigates to the root URL `/`, rendering `LandingPage` (`App.jsx:25-39`).
3. Alternatively, clicking the brand logo (`#auth-logo`) on the left panel executes the same navigation to `/`.

### 4.6 Theme Toggle Interaction
1. The user clicks `ThemeSelectorCompact` in the upper-right corner of the right panel (`AuthLayout.jsx:115`).
2. `ThemeSelector.jsx:15-16` calculates `nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light"`.
3. Calls `setTheme(nextTheme)` from `ThemeContext.jsx:25-28`.
4. Saves selection into `localStorage.setItem("covai_theme", newTheme)`.
5. The `useEffect` hook in `ThemeContext.jsx:30-57` updates `resolvedTheme`, sets attribute `data-theme` on `document.documentElement`, and adds or removes class `.dark`.
6. All CSS tokens defined in `client/src/index.css` (e.g., `--color-bg`, `--color-surface`, `--color-border`, `--color-text`) dynamically switch between light and dark palettes immediately altering the visual appearance of the Sign In page.

---

## 5. Validation, Loading, and Error States

| State / Trigger | UI Presentation | Technical Mechanism | Source Evidence |
|---|---|---|---|
| **Empty Email** | Red border on input; red text with `AlertCircle`: `"Email address is required"` | `!formData.email.trim()` detected during `validate()`; sets `errors.email`. | `AuthForm.jsx:57-59, 210-220` |
| **Invalid Email Format** | Red border on input; red text with `AlertCircle`: `"Please enter a valid email address"` | `!EMAIL_RE.test(formData.email)` failed during `validate()`; sets `errors.email`. | `AuthForm.jsx:59-61, 241-253` |
| **Empty Password** | Red border on input; red text with `AlertCircle`: `"Password is required"` | `!formData.password` detected during `validate()`; sets `errors.password`. | `AuthForm.jsx:62-64, 283-286` |
| **Short Password** | Red border on input; red text with `AlertCircle`: `"Password must be at least 8 characters"` | `formData.password.length < 8` failed during `validate()`; sets `errors.password`. | `AuthForm.jsx:64-66, 301-306` |
| **Form Submitting (Loading)** | Submit button shows spinning `Loader2` and text `"Signing in..."`; button is disabled with `opacity-50 cursor-not-allowed`. Inputs remain interactive. | `status === "loading"`; `disabled={status === "loading"}` on `#auth-submit-btn`. | `AuthForm.jsx:85, 357-366` |
| **Backend Credential Rejection** | Red alert banner at top of form: `AlertCircle` icon + message (e.g., `"Incorrect email or password!"`) | Backend returns HTTP 400; caught in `try...catch`; set to `serverMessage`. | `AuthForm.jsx:114-118, 177-183` |
| **Network / Server Outage** | Red alert banner: `"Authentication failed. Please verify credentials."` | Network error or unhandled status; falls back to default error string. | `AuthForm.jsx:115-117` |
| **Successful Authentication** | Form unmounts; green card with `CheckCircle2` icon: `"Sign in successful"`, `"Redirecting to projects..."` | `status === "success"`; timer waits 1000ms, then sets `window.location.href = "/projects"`. | `AuthForm.jsx:106-109, 144-154` |
| **Active Session Guard** | User visiting `/login` while logged in is redirected to `/projects` immediately. | `RedirectIfAuthenticated` checks `localStorage.getItem("token")`; returns `<Navigate to="/projects" replace />`. | `App.jsx:54-65, 83-88` |

---

## 6. Screenshot-to-Code Comparison

The following table compares each visual element in the provided screenshot against the source-code implementation:

| UI element | Screenshot observation | Source-code evidence | Status | Notes |
|---|---|---|---|---|
| **COVAI Logo & Version** | Purple rounded square with `>_` terminal glyph, text `"CovAI"`, and pill badge `"v2.4"` in top left. | Implemented via `<Link to="/" id="auth-logo">`, Lucide `Terminal`, and styled `v2.4` span in `AuthLayout.jsx:42-58`. | **MATCH** | Exact match in styling, icon choice, badge dimensions, and text. |
| **Left Panel Heading** | `"Automated Test Coverage & Deterministic Branch Verification"` in bold heading. | Text in `<h2>` element inside `AuthLayout.jsx:64-66`. | **MATCH** | Exact text and visual hierarchy. |
| **Left Panel Description** | Descriptive paragraph explaining synthesized unit tests, CFG branch detection, and sandbox runner. | Text in `<p>` element inside `AuthLayout.jsx:67-71`. | **MATCH** | Exact 1:1 wording match. |
| **Code Window Header** | macOS 3 window dots (red, yellow, green), label `tests / checkout.test.js`, and green badge `CheckCircle2` + `Jest 29.0 Pass`. | Implemented in `CodePreview.jsx:173-189` with Lucide `CheckCircle2`. | **MATCH** | Exact layout and iconography match. |
| **Code Preview Syntax Body** | 15 lines of mock test code for `checkout()`; lines 7 & 8 highlighted with purple tint, left border, and green checkmark `✓`. | Implemented in `CodePreview.jsx:3-148, 191-222`. Lines 7 and 8 have `highlight: true`. | **MATCH** | Exact tokenization, colors, checkmark markers, and code contents match. |
| **Code Window Status Bar** | Bottom bar: `Covered branch: Line 14 (throw new Error)`, `100% Branch`, `14ms`. | Implemented in `CodePreview.jsx:225-236` with Lucide `Terminal`. | **MATCH** | Exact match in wording, badges, and layout. |
| **Platform Pillars** | Three cards at bottom of left panel: "Control Flow", "Test Synthesis", "Sandbox Runner". | Rendered from `ARCHITECTURE_PILLARS` array in `AuthLayout.jsx:10-26, 79-97` with `GitBranch`, `Cpu`, `ShieldCheck`. | **MATCH** | Exact match in icon selection, card background, and titles. |
| **Back to Home Link** | Top left of right panel: arrow left icon with text `"Back to home"`. | Implemented via `<Link to="/" id="auth-back-home">` with Lucide `ArrowLeft` in `AuthLayout.jsx:106-113`. | **MATCH** | Exact match in icon, label, and navigation target (`/`). |
| **Theme Toggle Button** | Top right of right panel: square button displaying `Sun` icon. | Rendered by `<ThemeSelector compact />` in `AuthLayout.jsx:115` & `ThemeSelector.jsx:20-30`. In light theme (`resolvedTheme === "light"`), it renders `Sun`. | **MATCH** | Visual icon matches because the screenshot was captured in active light mode. |
| **Sign In Heading & Subtitle** | Heading `"Sign in to CovAI"` and subtitle `"Enter your credentials to access your projects and test dashboards."`. | Rendered in `AuthForm.jsx:133-140` when `isLogin === true`. | **MATCH** | Exact wording match. |
| **GitHub OAuth Button** | Full-width button with GitHub mark and label `"Continue with GitHub"`. | Implemented via `<button id="auth-github-btn">` with SVG GitHub icon in `AuthForm.jsx:159-167`. | **MATCH** | Exact match in label and styling. |
| **Email Divider** | Horizontal divider with centered text `"or continue with email"`. | Implemented via relative divider container in `AuthForm.jsx:169-175`. | **MATCH** | Exact visual match. |
| **Email Address Input** | Input labeled `"Email address *"` with mail icon, filled with text `"quy2@gmail.com"`. | In `AuthForm.jsx:226-247`, label is `"Email address *"`, icon is `Mail`, default placeholder is `"alex@company.com"`. In the screenshot, `"quy2@gmail.com"` represents user input or autofill state. | **MATCH** | The component matches; the value shown in the screenshot is runtime user input. |
| **Password Input** | Input labeled `"Password *"` with lock icon, filled with masked bullets `••••••••••`, eye toggle icon. | In `AuthForm.jsx:258-300`, label is `"Password *"`, icon is `Lock`, placeholder is `"••••••••"`, eye toggle icon is Lucide `Eye`. Masked bullets in screenshot represent user input. | **MATCH** | Exact visual match for a populated password field with masking active. |
| **Forgot Password Link** | Right-aligned link `"Forgot password?"` positioned above password input. | Implemented via `<button type="button" onClick={() => setMode("forgot_password")}>` in `AuthForm.jsx:265-272`. | **MATCH** | Exact text, position, and styling match. |
| **Sign In Button** | Purple button with label `"Sign In →"`. | In `AuthForm.jsx:354-374`, button has `bg-[var(--color-primary)]` with text `<span>Sign in</span>` and Lucide `ArrowRight`. | **PARTIAL MATCH** | **Label casing discrepancy:** Source code renders sentence case `"Sign in"` (`AuthForm.jsx:369`), whereas the screenshot shows Title Case `"Sign In"`. The right arrow is Lucide `ArrowRight`. |
| **Create Account Prompt** | Bottom text: `"Don't have an account? Create account"`. | Rendered in `AuthForm.jsx:377-389` via text and button `#auth-toggle-to-register`. | **MATCH** | Exact wording and styling match. |
| **Footer Sandbox Notice** | Not clearly visible or cropped out at bottom of screenshot. | Implemented in `AuthLayout.jsx:130-135` (`"© {year} CovAI Platform. Protected by isolated test sandbox."`). | **MATCH** (Cropped in screenshot) | The divider border is faintly visible at the bottom cut line; element exists in DOM. |

---

## 7. Findings and Limitations

### 7.1 Verified Behaviors
1. **Accurate Layout and Token System:** The Sign In interface faithfully implements the technical, dark/light compatible design system established in `COVAI_FRONTEND_AGENT_RULES.md` and `client/src/index.css`.
2. **Robust Multi-mode Layout Architecture:** `AuthLayout` cleanly manages transitions between Login, Registration, Forgot Password, and Reset Password states without requiring full page transitions.
3. **Dual Client & Backend Validation:** Form submissions validate email structure and password length on both the client (instant UI feedback via `validate()`) and backend (Zod schema `loginValid`).
4. **Token and Session Management:** Login issues a short-lived access token (15 minutes) saved in `localStorage` and a secure HTTP-only refresh token (7 days) stored in browser cookies.

### 7.2 Discrepancies and Implementation Gaps
1. **Submit Button Text Casing:**
   - **Screenshot:** Displays `"Sign In →"` with capital "I".
   - **Source Code (`AuthForm.jsx:369`):** Renders `<span>{isLogin ? "Sign in" : "Create account"}</span>` with lowercase "i".
2. **Session Storage Inconsistency (`user` object):**
   - In `GithubCallbackPage.jsx:37`, OAuth login stores `localStorage.setItem("user", JSON.stringify(userPayload))`.
   - In `AuthForm.jsx:93-95`, email/password login stores `token`, `userName`, and `userEmail`, but does **not** store the serialized `user` JSON object. While `ProtectedRoute` and `RedirectIfAuthenticated` check `localStorage.getItem("token")` first (so navigation works), downstream components that rely specifically on `localStorage.getItem("user")` might experience missing user metadata.
3. **Hardcoded OAuth Client ID Fallback:**
   - `AuthForm.jsx:124` falls back to a hardcoded client ID (`"Ov23liQyAORXbj6NeqAB"`) if `VITE_GITHUB_CLIENT_ID` is unset.
4. **Desktop-Only Showcase:**
   - The left technical showcase is hidden (`hidden lg:flex`) on screens narrower than 1024px, ensuring mobile users only see the authentication form.

### 7.3 Limitations of Static Analysis
- **Live OAuth Handshake:** External redirection to GitHub's authorization server and subsequent callback resolution require valid third-party credentials and cannot be verified solely through static repository inspection.
- **Email Delivery:** The password reset email delivery mechanism relies on external SMTP/SES services configured in `server/src/utils/sendEmail.js` and requires runtime verification.

---

## 8. Source References

The following exact file paths and source code locations provide evidence for every finding documented in this analysis:

1. **`client/src/pages/LoginPage.jsx`**
   - `LoginPage`: [Lines 1–5](file:///d:/NCKH/CovAI-/client/src/pages/LoginPage.jsx#L1-L5)
2. **`client/src/components/auth/AuthLayout.jsx`**
   - Architectural Pillars Array: [Lines 10–26](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L10-L26)
   - Layout Grid & Mode State: [Lines 28–35](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L28-L35)
   - Left Panel Branding & Showcase: [Lines 39–98](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L39-L98)
   - Right Panel Header (`#auth-back-home`, `<ThemeSelector />`): [Lines 105–116](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L105-L116)
   - Sub-view Mode Switcher: [Lines 119–127](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L119-L127)
   - Footer Sandbox Notice: [Lines 130–135](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L130-L135)
3. **`client/src/components/auth/AuthForm.jsx`**
   - Input State and Helpers: [Lines 31–50](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L31-L50)
   - Client Validation Logic: [Lines 52–71](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L52-L71)
   - Submit Handler & Redirection: [Lines 73–120](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L73-L120)
   - GitHub OAuth Trigger: [Lines 122–127](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L122-L127)
   - Form Title & Subtitle: [Lines 132–141](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L132-L141)
   - GitHub OAuth Button: [Lines 159–167](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L159-L167)
   - Email Input & Error: [Lines 225–254](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L225-L254)
   - Password Input, Visibility Toggle & Forgot Password: [Lines 256–307](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L256-L307)
   - Submit Button & Loading State: [Lines 354–374](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L354-L374)
   - Mode Toggle Prompt: [Lines 376–404](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L376-L404)
4. **`client/src/components/auth/CodePreview.jsx`**
   - Tokenized Code AST Representation: [Lines 3–148](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L3-L148)
   - Syntax Highlighting Helper: [Lines 151–168](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L151-L168)
   - Title Bar & Status Elements: [Lines 172–189](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L172-L189)
   - Code Gutter & Line Rendering: [Lines 191–222](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L191-L222)
   - Metrics Footer Bar: [Lines 225–236](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L225-L236)
5. **`client/src/components/common/ThemeSelector.jsx`**
   - Compact Theme Button: [Lines 13–31](file:///d:/NCKH/CovAI-/client/src/components/common/ThemeSelector.jsx#L13-L31)
6. **`client/src/contexts/ThemeContext.jsx`**
   - Theme Provider & DOM Synchronization: [Lines 9–64](file:///d:/NCKH/CovAI-/client/src/contexts/ThemeContext.jsx#L9-L64)
7. **`client/src/services/auth.service.js`**
   - `loginApi`: [Lines 113–133](file:///d:/NCKH/CovAI-/client/src/services/auth.service.js#L113-L133)
   - `oAuthGithubApi`: [Lines 138–147](file:///d:/NCKH/CovAI-/client/src/services/auth.service.js#L138-L147)
   - `forgotPasswordApi`: [Lines 153–164](file:///d:/NCKH/CovAI-/client/src/services/auth.service.js#L153-L164)
8. **`server/src/routes/auth.route.js`**
   - Router Definitions: [Lines 18–28](file:///d:/NCKH/CovAI-/server/src/routes/auth.route.js#L18-L28)
9. **`server/src/controllers/auth.controller.js`**
   - `login`: [Lines 42–74](file:///d:/NCKH/CovAI-/server/src/controllers/auth.controller.js#L42-L74)
   - `oAuthGithub`: [Lines 167–292](file:///d:/NCKH/CovAI-/server/src/controllers/auth.controller.js#L167-L292)
10. **`server/src/validators/auth.validation.js`**
    - `loginValid` Zod Schema: [Lines 12–15](file:///d:/NCKH/CovAI-/server/src/validators/auth.validation.js#L12-L15)
11. **`server/src/services/auth.service.js`**
    - Backend `login` service: [Lines 42–73](file:///d:/NCKH/CovAI-/server/src/services/auth.service.js#L42-L73)

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
| 16 | `AuthFormHeading` | Text Heading (`<h1>`) | Text: `"Sign in to CovAI"` | Screen title |
| 17 | `AuthFormDescription` | Descriptive Text (`<p>`) | Text: `"Enter your credentials to access your projects and test dashboards."` | Instructions for credential entry |
| 18 | `GithubOAuthButton` | Action Button | Button with GitHub logo and text `"Continue with GitHub"` | Redirects to GitHub OAuth authorization |
| 19 | `EmailDivider` | Text Separator | Horizontal line with text `"or continue with email"` | Separates OAuth from email login |
| 20 | `ServerErrorMessage` | Alert Banner | Conditionally rendered red alert box with `AlertCircle` icon and server error text | Informs user of authentication failure |
| 21 | `EmailInputLabel` | Field Label (`<label>`) | Text: `"Email address *"` | Identifies email input field |
| 22 | `EmailInputField` | Input Field (`type="email"`) | Mail icon on left, placeholder `"alex@company.com"`, bound to `formData.email` | Accepts user email address |
| 23 | `EmailValidationError` | Validation Message | Conditionally rendered red error text with `AlertCircle` icon below email input | Informs user of missing or malformed email |
| 24 | `PasswordInputLabel` | Field Label (`<label>`) | Text: `"Password *"` | Identifies password input field |
| 25 | `ForgotPasswordLink` | Action Button | Right-aligned text: `"Forgot password?"` with primary color and hover underline | Switches view to Forgot Password form |
| 26 | `PasswordInputField` | Password Input (`type="password"` / `"text"`) | Lock icon on left, placeholder `"••••••••"`, dynamic masking bound to `formData.password` | Accepts user password |
| 27 | `PasswordVisibilityToggle` | Icon Button | Eye icon (`Eye` / `EyeOff`) positioned inside right of password input | Toggles password visibility |
| 28 | `PasswordValidationError` | Validation Message | Conditionally rendered red error text with `AlertCircle` icon below password input | Informs user of password requirement |
| 29 | `SignInSubmitButton` | Submit Button | Purple button with text `"Sign in"` and right arrow icon; shows `"Signing in..."` when loading | Submits credentials to `POST /api/auth/login` |
| 30 | `CreateAccountPrompt` | Text Container | Text: `"Don't have an account? "` | Registration prompt |
| 31 | `CreateAccountToggleButton` | Text Action Button | Text: `"Create account"` with primary styling | Toggles form to Registration mode |
| 32 | `SuccessBanner` | Status Card | Green card with `CheckCircle2` icon, `"Sign in successful"`, `"Redirecting to projects..."` | Confirms successful sign-in before redirect |
| 33 | `AuthFooterNotice` | Footer Text | Bottom text: `"© {year} CovAI Platform. Protected by isolated test sandbox."` | Displays platform copyright and notice |
