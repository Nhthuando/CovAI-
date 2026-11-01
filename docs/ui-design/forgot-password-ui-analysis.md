# COVAI Forgot Password UI — Implementation Analysis

## 1. Overview

The **Forgot Password interface** (Use Case **UC-04: Password Recovery**) provides a secure self-service credential recovery mechanism for registered users on the COVAI platform. Its purpose is to accept a developer's registered email address, initiate backend identity verification, generate a cryptographically secure, time-limited password reset token, and dispatch a recovery link via automated email without leaking account existence to unauthorized parties.

Architecturally, the Forgot Password interface does **not** reside on an independent URL route (such as `/forgot-password`). Instead, it is implemented as a swappable sub-view mode (`mode === "forgot_password"`) within the unified desktop/mobile authentication shell (`AuthLayout.jsx`) mounted at `/login`.

The interface renders the standardized COVAI split two-column responsive layout:
1. **Left Panel (Technical Showcase):** A desktop-only (`hidden lg:flex`) branding and feature demonstration pane. It showcases the COVAI terminal emblem, release version identifier (`v2.4`), core value proposition heading, a simulated Monaco-style Jest test execution preview with deterministic branch coverage metrics (`tests/checkout.test.js`), and three architectural pillars (Control Flow, Test Synthesis, and Sandbox Runner).
2. **Right Panel (Password Recovery Container):** A focused form column containing:
   - **Global Navigation & Utilities:** Top navigation bar with a "Back to home" return link (`/`) and a compact theme toggle cycling between light, dark, and system themes.
   - **Password Recovery Form (Input State):** Title heading `"Reset your password"`, instructional subtitle, single controlled email input with validation, full-width purple submission button `"Send Reset Link"`, and a `"Back to Sign In"` mode toggle.
   - **Dispatched Confirmation Card (Success State):** Once the backend request succeeds, the form unmounts and is replaced by a `"Reset Link Dispatched"` status card with instructions and a `"Return to Sign In"` action button.

The application is built with **React 19**, **Vite**, **React Router v7**, and styled with **Tailwind CSS v4** utilizing strict CSS variable tokens defined in `client/src/index.css`.

---

## 2. Implementation Files

The following table documents all frontend and backend source files responsible for the Forgot Password interface, rate limiting, token generation, and email dispatch pipeline:

| File Path | Component/Function | Responsibility | Evidence |
|---|---|---|---|
| `client/src/components/auth/ForgotPasswordForm.jsx` | `ForgotPasswordForm` | Primary recovery form component; manages email input state, client validation, loading state, error alerts, submission to `forgotPasswordApi`, and the success confirmation view. | Lines 14–145: State hooks (`email`, `status`, `errorMsg`), `handleSubmit()`, `<Button>` integration, dual-state rendering (`status === "success"` vs form view). |
| `client/src/components/auth/AuthLayout.jsx` | `AuthLayout` | Primary 2-column layout container; manages mode switching (`mode === "forgot_password"`), mounts `ForgotPasswordForm`, and renders left technical showcase and top utilities. | Lines 28–139: Mode router line 121: `{mode === "forgot_password" ? <ForgotPasswordForm setMode={setMode} /> : ...}`, `#auth-logo`, `#auth-back-home`, `<ThemeSelector compact />`. |
| `client/src/components/auth/AuthForm.jsx` | `AuthForm` | Main login/registration form; contains the entry-point trigger button (`"Forgot password?"`) that switches `AuthLayout` into `"forgot_password"` mode. | Lines 265–272: `<button type="button" onClick={() => setMode("forgot_password")}>Forgot password?</button>`. |
| `client/src/components/common/Button.jsx` | `Button` | Reusable design-system button supporting primary/secondary variants, loading spinners (`Loader2`), disabled states, and icon positioning. | Lines 5–94: Used for `"Send Reset Link"` (`variant="primary"`) and `"Return to Sign In"` (`variant="secondary"`). |
| `client/src/components/auth/CodePreview.jsx` | `CodePreview` | Syntax-highlighted mock IDE/test runner card displaying Jest 29.0 execution, covered branch indicators, execution duration, and pass status. | Lines 1–239: Static tokenized code representation of `tests/checkout.test.js`, macOS-style title bar controls, line gutter checkmarks, branch execution status bar. |
| `client/src/components/common/ThemeSelector.jsx` | `ThemeSelector` | Global theme switcher; in `compact` mode, cycles between light, dark, and system schemes. | Lines 4–31: Compact button cycling `light -> dark -> system`, renders `Sun`, `Moon`, or `Monitor` based on resolved theme. |
| `client/src/contexts/ThemeContext.jsx` | `ThemeProvider`, `useTheme` | Context provider managing theme state, `localStorage` key `covai_theme`, and `document.documentElement` attributes (`data-theme`, class `dark`). | Lines 9–72: Syncs state with DOM root and system media query `(prefers-color-scheme: dark)`. |
| `client/src/services/auth.service.js` | `forgotPasswordApi` | Frontend HTTP client wrapper executing `POST /api/auth/forgotPassword` via `fetchWithAuth`. | Lines 153–164: Formats JSON payload `{ email }`, parses response, maps error messages. |
| `server/src/routes/auth.route.js` | Express Router | Backend authentication routes defining endpoints and middleware bindings. | Line 24: `router.post("/forgotPassword", authLimiter, forgotPassword);`. |
| `server/src/middlewares/rateLimit.middleware.js` | `authLimiter` | Express IP rate limiter restricting authentication attempts to 10 requests per 15-minute window. | Lines 22–31: `windowMs: 15 * 60 * 1000`, `max: 10`, message: `"Too many attempts, please try again in 15 minutes."`. |
| `server/src/controllers/forgotPassword.controller.js` | `forgotPassword` | Backend controller handling user lookup, user enumeration protection, 1-minute cooldown enforcement, SHA-256 token generation, and email dispatch. | Lines 8–33: `prisma.user.findUnique`, cooldown check `passwordResetExpires > new Date()`, `crypto.randomBytes(32)`, `sendEmail()`. |
| `server/src/utils/sendEmail.js` | `sendEmail` | Nodemailer SMTP email transporter using Gmail service credentials (`EMAIL_USERNAME`, `EMAIL_APP_PASSWORD`). | Lines 3–30: Creates Gmail transport, defines sender `'"CovAI Service" <servicecovai98@gmail.com>'`, dispatches mail. |
| `server/src/utils/emailTemplate.js` | `resetPasswordEmailHtml` | Responsive HTML email template rendering the reset link button, fallback plaintext URL, and 1-minute expiration notice. | Lines 1–72: Produces branded HTML email with recipient name and reset URL `${clientUrl}/reset-password?token=${resetToken}`. |
| `client/src/pages/ResetPasswordPage.jsx` | `ResetPasswordPage` | Target landing route (`/reset-password`) for the dispatched email link, mounting `<AuthLayout initialMode="reset_password" />`. | Lines 1–5: Downstream completion route for UC-04. |

---

## 3. UI Specification

The following five-column specification table details all confirmed UI elements of the COVAI Forgot Password interface across both the initial form state and the dispatched success state:

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
| 16 | `ForgotPasswordHeading` | Text Heading (`<h1>`) | Top of password recovery form; visible text: `"Reset your password"`; styling: `text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-text)] mb-1.5`; source: `ForgotPasswordForm.jsx:74-76`. | Establishes screen context for initiating password recovery. |
| 17 | `ForgotPasswordDescription` | Descriptive Text (`<p>`) | Visible text: `"Enter your email address and we'll send you a link to reset your credentials."`; styling: `text-xs sm:text-sm text-[var(--color-text-secondary)] leading-relaxed`; source: `ForgotPasswordForm.jsx:77-80`. | Instructions explaining how the email reset workflow operates. |
| 18 | `ErrorMessageBanner` | Alert Banner (Conditional) | Conditionally rendered when `errorMsg` state is non-empty; `p-3 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 flex items-start gap-2 mb-4 text-xs text-[var(--color-danger)]`; Lucide `AlertCircle` (`w-4 h-4 shrink-0 mt-0.5`); source: `ForgotPasswordForm.jsx:84-89`. | Displays validation errors or server rejection messages (e.g., cooldown warnings or network errors). |
| 19 | `EmailInputLabel` | Form Field Label (`<label>`) | `htmlFor="forgot-email"`; `block text-xs font-medium text-[var(--color-text)] mb-1.5`; visible text: `"Email address "` with red asterisk `<span className="text-[var(--color-danger)]">*</span>`; source: `ForgotPasswordForm.jsx:94-100`. | Identifies email input requirement. |
| 20 | `EmailInputField` (`#forgot-email`) | Input Field (`type="email"`) | Input element: `w-full h-10 pl-10 pr-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] transition-colors focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]`; placeholder: `"engineer@company.com"`; left icon: Lucide `Mail` (`w-4 h-4 text-[var(--color-text-muted)] absolute left-3.5 pointer-events-none`); source: `ForgotPasswordForm.jsx:101-115`. | Controlled input bound to `email` state; receives user email address for reset dispatch. |
| 21 | `SendResetLinkButton` | Submit Action Button | Primary full-width button; implemented via common `<Button type="submit" variant="primary" size="md">`; styling: `w-full font-semibold bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)] text-white text-sm`; idle content: `<span>Send Reset Link</span>` + Lucide `ArrowRight` (right aligned); loading content: Lucide `Loader2` (spinning) + `<span>Send Reset Link</span>`; disabled when loading; source: `ForgotPasswordForm.jsx:117-127`. | Validates email format, enters loading state, invokes `forgotPasswordApi`, and displays the success card on HTTP 200. |
| 22 | `BackToSignInButton` | Text Action Button | Bottom navigation link below form; `<button type="button" onClick={() => setMode("login")}>`; styling: `inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer`; contains Lucide `ArrowLeft` (`w-3.5 h-3.5`) + text `"Back to Sign In"`; source: `ForgotPasswordForm.jsx:131-140`. | Calls `setMode("login")` to revert `AuthLayout` mode back to `"login"`, displaying the Sign In form in-place. |
| 23 | `AuthFooterNotice` | Footer Disclaimer Text | Positioned at bottom of right panel; `pt-6 border-t border-[var(--color-border)] text-center text-xs text-[var(--color-text-muted)]`; text: `"© {year} CovAI Platform. Protected by isolated test sandbox."`; source: `AuthLayout.jsx:130-135`. | Displays platform copyright and sandbox protection notice. |
| 24 | `SuccessCardContainer` | Status Card Container (Conditional) | Displayed when `status === "success"`; replaces input form with `p-6 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] text-center`; source: `ForgotPasswordForm.jsx:46-70`. | Encloses post-dispatch confirmation message and return action. |
| 25 | `SuccessCardIcon` | Status Icon | Large centered checkmark: Lucide `CheckCircle2` (`w-10 h-10 text-[var(--color-success)] mx-auto mb-3`); source: `ForgotPasswordForm.jsx:48`. | Visual confirmation of dispatched recovery request. |
| 26 | `SuccessCardHeading` | Text Heading (`<h2>`) | Visible text: `"Reset Link Dispatched"`; styling: `text-lg font-bold text-[var(--color-text)] mb-2`; source: `ForgotPasswordForm.jsx:49-51`. | Header for post-submission confirmation state. |
| 27 | `SuccessCardDescription` | Descriptive Text (`<p>`) | Visible text: `"If an account exists for {email}, you will receive password reset instructions shortly."` with `{email}` wrapped in `<span className="font-semibold text-[var(--color-text)]">`; styling: `text-xs text-[var(--color-text-secondary)] leading-relaxed mb-6`; source: `ForgotPasswordForm.jsx:52-58`. | Confirms request processing while adhering to user enumeration protection. |
| 28 | `ReturnToSignInButton` | Action Button | Secondary full-width button inside success card; implemented via `<Button type="button" variant="secondary" size="md" className="w-full" onClick={() => setMode("login")} icon={ArrowLeft}>Return to Sign In</Button>`; source: `ForgotPasswordForm.jsx:59-68`. | Calls `setMode("login")` to dismiss the confirmation card and return to the Sign In interface. |

---

## 4. Password Recovery Interaction Flow

### 4.1 Navigation into Forgot Password
1. User navigates to the Sign In interface at `/login`.
2. Above the password field, user clicks the `"Forgot password?"` link (`AuthForm.jsx:267`).
3. The click handler invokes `setMode("forgot_password")`.
4. In `AuthLayout.jsx:120-122`, the condition `mode === "forgot_password"` evaluates to true.
5. `AuthForm` unmounts and `<ForgotPasswordForm setMode={setMode} />` mounts in-place within the right panel container. The browser URL remains `/login`.

### 4.2 Email Input & Client-Side Validation
1. **User Input:** User types their email address into `EmailInputField` (`#forgot-email`). Input is controlled via local React state:
   ```javascript
   onChange={(e) => {
     setEmail(e.target.value);
     setErrorMsg("");
   }}
   ```
   Typing automatically dismisses any previously visible error message.
2. **Submission Trigger:** User clicks `SendResetLinkButton` (`"Send Reset Link"`) or presses Enter.
3. **Client-Side Validation (`handleSubmit`):**
   - **Empty Check:** If `!email.trim()` is true, sets `errorMsg = "Email address is required"` and `status = "error"`.
   - **Regex Check:** If `!EMAIL_RE.test(email)` fails (where `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/`), sets `errorMsg = "Please enter a valid email address"` and `status = "error"`.
   - If either check fails, execution aborts immediately without dispatching any network request.

### 4.3 API Dispatch & Backend Processing
1. If validation passes, `errorMsg` is reset to `""` and `status` is set to `"loading"`.
2. `SendResetLinkButton` transitions into a loading state, rendering a spinning `Loader2` icon and disabling pointer events.
3. The client invokes `forgotPasswordApi(email.trim().toLowerCase())` (`client/src/services/auth.service.js:153-164`), sending a `POST` request to `http://localhost:5000/api/auth/forgotPassword` with JSON payload `{ email }`.
4. **Backend Pipeline (`server/src/controllers/forgotPassword.controller.js:8-33`):**
   - **Rate Limiting:** Request passes through `authLimiter` (maximum 10 attempts per 15 minutes per IP).
   - **Account Lookup:** Backend queries PostgreSQL using Prisma: `prisma.user.findUnique({ where: { email } })`.
   - **User Enumeration Prevention:** If no user matches the email (`!user`), the backend immediately returns HTTP 200 with `{ message: "Password reset link has been sent, please check your email!" }`.
   - **Active Token Cooldown:** If `user.passwordResetExpires && user.passwordResetExpires > new Date()`, the backend rejects the duplicate request with HTTP 429: `{ message: "Please wait for previous link to expire (1 minute) before requesting again." }`.
   - **Token Generation:**
     - Generates 32 random bytes converted to hex: `crypto.randomBytes(32).toString('hex')` (64-character token).
     - Computes SHA-256 hash: `crypto.createHash('sha256').update(resetToken).digest('hex')`.
     - Sets expiry timestamp: `new Date(Date.now() + 1 * 60 * 1000)` (1 minute from creation).
     - Persists hashed token and expiry in the database user record:
       ```javascript
       await prisma.user.update({
         where: { email },
         data: { passwordResetToken: hashedToken, passwordResetExpires: tokenExpires },
       });
       ```
   - **Email Dispatch:**
     - Constructs reset URL: `${clientUrl}/reset-password?token=${resetToken}`.
     - Calls `sendEmail(...)` via Nodemailer Gmail transport (`server/src/utils/sendEmail.js`).
     - Renders branded HTML template (`server/src/utils/emailTemplate.js`).
     - If email sending fails, reverts token fields in DB to `null` and returns HTTP 500: `{ message: "Error sending email, please try again." }`.
     - If email sending succeeds, returns HTTP 200: `{ message: "Password reset link has been sent, please check your email!" }`.

### 4.4 Client Response Handling
- **On HTTP 200 (Success):**
  - Caught in `try` block (`ForgotPasswordForm.jsx:37`).
  - Sets `status = "success"`.
  - The form unmounts and renders the `SuccessCardContainer` (`"Reset Link Dispatched"`), displaying the entered email in bold.
  - **No automatic navigation occurs.** The user remains on the success card until explicitly choosing to return to Sign In.
- **On HTTP Error (Failure / Cooldown / Network Outage):**
  - Caught in `catch (error)` block (`ForgotPasswordForm.jsx:38-41`).
  - Sets `errorMsg = error.message || "Failed to send reset link."`.
  - Sets `status = "error"`.
  - Displays `ErrorMessageBanner` above the form. User can correct the email or wait for the cooldown to expire and click `"Send Reset Link"` again.

### 4.5 Navigation Back to Sign In
1. **From Form View:** User clicks `"Back to Sign In"` (`ForgotPasswordForm.jsx:132-139`). Handler executes `setMode("login")`.
2. **From Success View:** User clicks `"Return to Sign In"` (`ForgotPasswordForm.jsx:59-68`). Handler executes `setMode("login")`.
3. In both scenarios, `AuthLayout` updates `mode` to `"login"`, unmounting `ForgotPasswordForm` and mounting `AuthForm` in-place.

---

## 5. Validation, Loading, Success, and Error States

The following table documents every implemented validation rule, error trigger, loading indicator, and success condition for the Forgot Password interface:

| State / Trigger | UI Presentation | Technical Mechanism | Source Evidence |
|---|---|---|---|
| **Empty Email Address** | Red alert banner above form with `AlertCircle`: `"Email address is required"` | `!email.trim()` detected in `handleSubmit()`; sets `errorMsg` and `status = "error"`. Input border does not change style. | `ForgotPasswordForm.jsx:21-25, 84-89` |
| **Invalid Email Format** | Red alert banner above form with `AlertCircle`: `"Please enter a valid email address"` | `!EMAIL_RE.test(email)` failed in `handleSubmit()`; sets `errorMsg` and `status = "error"`. | `ForgotPasswordForm.jsx:26-30, 84-89` |
| **Request Submitting (Loading)** | Submit button displays spinning `Loader2` icon and remains labeled `"Send Reset Link"`; button is disabled with `opacity-50 pointer-events-none`. Email input remains interactive. | `status === "loading"`; passed as `loading={status === "loading"}` to `<Button>`. | `ForgotPasswordForm.jsx:33, 121`, `Button.jsx:25, 52-54` |
| **Successful Request** | Form unmounts; green `CheckCircle2` icon (w-10 h-10) appears with heading `"Reset Link Dispatched"`, confirmation text with user's email, and secondary button `"Return to Sign In"`. | `status === "success"`; conditional render in `ForgotPasswordForm.jsx:46-70`. | `ForgotPasswordForm.jsx:37, 46-70` |
| **Email Not in Database** | Identical success card: `"Reset Link Dispatched"`. No error is indicated. | Backend user enumeration prevention: returns HTTP 200 `{ message: "Password reset link has been sent, please check your email!" }`. | `server/src/controllers/forgotPassword.controller.js:12-14` |
| **Cooldown Active (Repeated Request < 1 min)** | Red alert banner above form: `AlertCircle` + `"Please wait for previous link to expire (1 minute) before requesting again."` | Backend detects `passwordResetExpires > new Date()`; returns HTTP 429. Client catches and sets `errorMsg`. | `server/src/controllers/forgotPassword.controller.js:15`, `ForgotPasswordForm.jsx:39-40` |
| **IP Rate Limit Exceeded (10 requests / 15 min)** | Red alert banner above form: `AlertCircle` + `"Too many attempts, please try again in 15 minutes."` | Express `authLimiter` blocks request with HTTP 429 before reaching controller. Client displays response message. | `server/src/middlewares/rateLimit.middleware.js:22-31` |
| **SMTP / Email Delivery Failure** | Red alert banner above form: `AlertCircle` + `"Error sending email, please try again."` | `sendEmail()` throws error; backend rolls back DB tokens and returns HTTP 500. Client displays message. | `server/src/controllers/forgotPassword.controller.js:25-28` |
| **Network Failure / Server Offline** | Red alert banner above form: `AlertCircle` + `"Failed to send reset link."` (or fetch error string) | Fetch call throws network error; catch block falls back to default error message. | `ForgotPasswordForm.jsx:39` |

---

## 6. Screenshot-to-Code Comparison

The following table compares each visual element described in the Forgot Password reference against the actual source-code implementation:

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
| **Reset Password Heading** | Heading text: `"Reset your password"`. | Implemented in `ForgotPasswordForm.jsx:75` as `<h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-text)] mb-1.5">Reset your password</h1>`. | **MATCH** | Exact wording and styling match. |
| **Reset Password Description** | Subtitle: `"Enter your email address and we'll send you a link to reset your credentials."`. | Implemented in `ForgotPasswordForm.jsx:77-80` as `<p className="text-xs sm:text-sm text-[var(--color-text-secondary)] leading-relaxed">`. | **MATCH** | Exact 1:1 wording match. |
| **Email Address Label** | Label `"Email address "` with red required indicator `*`. | Implemented in `ForgotPasswordForm.jsx:95-100` with `htmlFor="forgot-email"` and `<span className="text-[var(--color-danger)]">*</span>`. | **MATCH** | Exact match in label and required indicator. |
| **Email Address Input** | Input field with envelope icon and placeholder `"engineer@company.com"`. | Implemented in `ForgotPasswordForm.jsx:101-114` with Lucide `Mail` icon and `placeholder="engineer@company.com"`. | **MATCH** | Note: In `AuthForm.jsx`, placeholder is `"alex@company.com"`, whereas here it is `"engineer@company.com"`. Matches screenshot observation exactly. |
| **Send Reset Link Button** | Full-width purple button with text `"Send Reset Link"` and right-arrow icon. | Implemented via `<Button type="submit" variant="primary" size="md" className="w-full font-semibold" icon={ArrowRight} iconPosition="right">Send Reset Link</Button>` in `ForgotPasswordForm.jsx:117-127`. | **MATCH** | Exact match in text, purple theme styling (`var(--color-primary)`), and right arrow icon. |
| **Back to Sign In Link** | Centered link with left-arrow icon and text `"Back to Sign In"`. | Implemented in `ForgotPasswordForm.jsx:132-139` with Lucide `ArrowLeft` (`w-3.5 h-3.5`) and text `"Back to Sign In"`. | **MATCH** | Exact match in icon, label, and mode-switch behavior. |
| **Footer Sandbox Notice** | Not clearly visible or cropped out at bottom of screenshot. | Implemented in `AuthLayout.jsx:130-135` (`"© {year} CovAI Platform. Protected by isolated test sandbox."`). | **MATCH** (Cropped in screenshot) | The divider border is faintly visible at the bottom cut line; element exists in DOM. |

---

## 7. Backend and Email Integration

### 7.1 Backend Endpoint Specification
- **Method & Route:** `POST /api/auth/forgotPassword`
- **Controller:** `server/src/controllers/forgotPassword.controller.js:8-33`
- **Request Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "email": "engineer@company.com"
  }
  ```
- **Responses:**
  - `200 OK`: `{ "message": "Password reset link has been sent, please check your email!" }`
  - `429 Too Many Requests` (cooldown): `{ "message": "Please wait for previous link to expire (1 minute) before requesting again." }`
  - `429 Too Many Requests` (IP limiter): `{ "success": false, "message": "Too many attempts, please try again in 15 minutes." }`
  - `500 Internal Server Error` (mail failure): `{ "message": "Error sending email, please try again." }`
  - `500 Internal Server Error` (unhandled): `{ "message": "Internal server error!" }`

### 7.2 Cryptographic Token Lifecycle
1. **Entropy & Generation:** `crypto.randomBytes(32).toString('hex')` generates a 256-bit CSPRNG token (64-character hex string).
2. **Storage Security:** The raw token is **never** saved directly in the database. Instead, the backend computes an unsalted SHA-256 hash:
   ```javascript
   const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
   ```
   and persists `hashedToken` in `prisma.user.update({ where: { email }, data: { passwordResetToken: hashedToken, passwordResetExpires: tokenExpires } })`.
3. **Expiration Window:** The expiration duration is set to:
   ```javascript
   const tokenExpires = new Date(Date.now() + 1 * 60 * 1000); // 1 minute
   ```
4. **Single-Use Enforcement:** When the user consumes the token at `POST /api/auth/resetPassword/:token`, line 45 of `server/src/controllers/forgotPassword.controller.js` explicitly clears both fields:
   ```javascript
   await prisma.user.update({
     where: { id: validUser.id },
     data: { passwordHash: hashedPass, passwordResetExpires: null, passwordResetToken: null },
   });
   ```
   This guarantees that each token can only be consumed once.

### 7.3 Email Delivery Service
- **Transporter Configuration (`server/src/utils/sendEmail.js`):**
  Uses `nodemailer` configured with Gmail service credentials:
  - `user: process.env.EMAIL_USERNAME`
  - `pass: process.env.EMAIL_APP_PASSWORD`
  - `from: '"CovAI Service" <servicecovai98@gmail.com>'`
- **Template Rendering (`server/src/utils/emailTemplate.js`):**
  - Subject: `"RESET PASSWORD | CovAI Service"`
  - Direct Action Button: Pointing to `${clientUrl}/reset-password?token=${resetToken}`.
  - Plaintext Fallback: Includes the full raw URL in a monospace block.
  - Recipient Personalization: Greets user by name (`user.name`).
  - Disclosed Expiration: Explicitly states `"This link will expire in 1 minute."`.

---

## 8. Findings and Limitations

### 8.1 Verified Functionality
1. **Complete UI Alignment:** All visual elements, text strings, icons, button positions, and placeholders in `ForgotPasswordForm.jsx` match the reference screenshot with 100% precision.
2. **Security-Conscious User Enumeration Prevention:** The backend intentionally returns HTTP 200 with a generic success confirmation even if the email does not exist in the database, preventing attackers from harvesting valid user accounts.
3. **Double Throttling Protection:**
   - Global rate limiter `authLimiter` limits IP submissions to 10 requests per 15 minutes.
   - User-level cooldown rejects repeat requests within 1 minute with HTTP 429.
4. **Hashed Token Storage:** Tokens are stored as SHA-256 hashes in PostgreSQL, preventing compromise even in the event of an unauthorized database dump.
5. **No Route Switching Overhead:** Mounting `ForgotPasswordForm` via in-place state switching (`mode === "forgot_password"`) eliminates unnecessary roundtrip routing and maintains layout stability.

### 8.2 Inconsistencies and Implementation Gaps
1. **Aggressive Token Expiry Window (1 Minute):**
   - The token expires in exactly 60 seconds (`Date.now() + 1 * 60 * 1000`).
   - If an SMTP server incurs slight delivery latency, or if a user takes more than 60 seconds to switch to their email client and click the link, the token becomes invalid (`"Invalid or expired token"`). Industry standards typically recommend 15 to 60 minutes.
2. **Brand Name Discrepancy in Email Template:**
   - In the frontend application, the platform is consistently branded as **`CovAI`** (version `v2.4`).
   - In `server/src/utils/emailTemplate.js:19, 28, 63`, the header and body text refer to **`TestCovAI`** (`"We received a request to reset your TestCovAI password"`).
3. **No Independent URL Route:**
   - Direct bookmarking or navigating to `/forgot-password` is not supported because no such route is registered in `App.jsx`. Access is only possible by loading `/login` and clicking `"Forgot password?"`.
4. **Input Error Styling Discrepancy:**
   - In `AuthForm.jsx`, input fields with errors dynamically receive `border-[var(--color-danger)]`.
   - In `ForgotPasswordForm.jsx:112`, the input field uses static border classes `border border-[var(--color-border)]`; errors are displayed exclusively via the top `ErrorMessageBanner` without a red input border highlight.

### 8.3 Limitations of Static Analysis
- **Live SMTP Transmission:** End-to-end email arrival in a real user inbox depends on valid `EMAIL_USERNAME` and `EMAIL_APP_PASSWORD` environment variables and live Gmail SMTP servers.
- **Client URL Resolution:** The reset link host relies on `process.env.CLIENT_URL` (defaulting to `http://localhost:5173`); incorrect production configuration could generate unreachable reset links.

---

## 9. Source References

The following exact file paths and source code locations provide evidence for every finding documented in this analysis:

1. **`client/src/components/auth/ForgotPasswordForm.jsx`**
   - Form State Hooks (`email`, `status`, `errorMsg`): [Lines 15–17](file:///d:/NCKH/CovAI-/client/src/components/auth/ForgotPasswordForm.jsx#L15-L17)
   - Submit Handler & Client Validation: [Lines 19–42](file:///d:/NCKH/CovAI-/client/src/components/auth/ForgotPasswordForm.jsx#L19-L42)
   - Success Card Rendering: [Lines 46–70](file:///d:/NCKH/CovAI-/client/src/components/auth/ForgotPasswordForm.jsx#L46-L70)
   - Form Header (`<h1>`, `<p>`): [Lines 73–81](file:///d:/NCKH/CovAI-/client/src/components/auth/ForgotPasswordForm.jsx#L73-L81)
   - Error Alert Banner: [Lines 84–89](file:///d:/NCKH/CovAI-/client/src/components/auth/ForgotPasswordForm.jsx#L84-L89)
   - Email Input Field & Label: [Lines 93–115](file:///d:/NCKH/CovAI-/client/src/components/auth/ForgotPasswordForm.jsx#L93-L115)
   - Send Reset Link Button: [Lines 117–128](file:///d:/NCKH/CovAI-/client/src/components/auth/ForgotPasswordForm.jsx#L117-L128)
   - Back to Sign In Action Button: [Lines 131–140](file:///d:/NCKH/CovAI-/client/src/components/auth/ForgotPasswordForm.jsx#L131-L140)
2. **`client/src/components/auth/AuthLayout.jsx`**
   - Layout Grid & Mode State: [Lines 28–35](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L28-L35)
   - Left Panel Branding & Showcase: [Lines 39–98](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L39-L98)
   - Right Panel Header (`#auth-back-home`, `<ThemeSelector />`): [Lines 105–116](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L105-L116)
   - Sub-view Mode Router: [Lines 120–127](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L120-L127)
   - Footer Sandbox Notice: [Lines 130–135](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthLayout.jsx#L130-L135)
3. **`client/src/components/auth/AuthForm.jsx`**
   - Forgot Password Navigation Trigger: [Lines 264–272](file:///d:/NCKH/CovAI-/client/src/components/auth/AuthForm.jsx#L264-L272)
4. **`client/src/components/common/Button.jsx`**
   - Button Base Styles & Variants: [Lines 24–48](file:///d:/NCKH/CovAI-/client/src/components/common/Button.jsx#L24-L48)
   - Loading Spinner & Icon Layout: [Lines 50–62](file:///d:/NCKH/CovAI-/client/src/components/common/Button.jsx#L50-L62)
5. **`client/src/components/auth/CodePreview.jsx`**
   - Tokenized AST Data: [Lines 3–148](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L3-L148)
   - Title Bar & Status Elements: [Lines 172–189](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L172-L189)
   - Line Rendering & Metrics Footer: [Lines 191–236](file:///d:/NCKH/CovAI-/client/src/components/auth/CodePreview.jsx#L191-L236)
6. **`client/src/components/common/ThemeSelector.jsx`**
   - Compact Theme Button: [Lines 13–31](file:///d:/NCKH/CovAI-/client/src/components/common/ThemeSelector.jsx#L13-L31)
7. **`client/src/contexts/ThemeContext.jsx`**
   - Theme Provider & DOM Sync: [Lines 9–64](file:///d:/NCKH/CovAI-/client/src/contexts/ThemeContext.jsx#L9-L64)
8. **`client/src/services/auth.service.js`**
   - `forgotPasswordApi`: [Lines 153–164](file:///d:/NCKH/CovAI-/client/src/services/auth.service.js#L153-L164)
9. **`server/src/routes/auth.route.js`**
   - Forgot Password Route Binding: [Line 24](file:///d:/NCKH/CovAI-/server/src/routes/auth.route.js#L24)
10. **`server/src/middlewares/rateLimit.middleware.js`**
    - `authLimiter` Rate Limiter: [Lines 22–31](file:///d:/NCKH/CovAI-/server/src/middlewares/rateLimit.middleware.js#L22-L31)
11. **`server/src/controllers/forgotPassword.controller.js`**
    - `forgotPassword` Handler: [Lines 8–33](file:///d:/NCKH/CovAI-/server/src/controllers/forgotPassword.controller.js#L8-L33)
12. **`server/src/utils/sendEmail.js`**
    - Nodemailer Transporter & `sendEmail`: [Lines 3–30](file:///d:/NCKH/CovAI-/server/src/utils/sendEmail.js#L3-L30)
13. **`server/src/utils/emailTemplate.js`**
    - HTML Email Template Function: [Lines 1–72](file:///d:/NCKH/CovAI-/server/src/utils/emailTemplate.js#L1-L72)

---

## 10. Final UI Specification Table

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
| 16 | `ForgotPasswordHeading` | Text Heading (`<h1>`) | Text: `"Reset your password"` | Screen title |
| 17 | `ForgotPasswordDescription` | Descriptive Text (`<p>`) | Text: `"Enter your email address and we'll send you a link to reset your credentials."` | Instructions for password recovery |
| 18 | `ErrorMessageBanner` | Alert Banner | Conditionally rendered red alert box with `AlertCircle` icon and error message | Informs user of invalid input or server errors |
| 19 | `EmailInputLabel` | Field Label (`<label>`) | Text: `"Email address *"` | Identifies email input field |
| 20 | `EmailInputField` | Input Field (`type="email"`) | Mail icon on left, placeholder `"engineer@company.com"`, bound to `email` state | Accepts user email address |
| 21 | `SendResetLinkButton` | Submit Button | Purple button with text `"Send Reset Link"` and right arrow icon; shows spinning `Loader2` when loading | Submits email to `POST /api/auth/forgotPassword` |
| 22 | `BackToSignInButton` | Text Action Button | Text: `"Back to Sign In"` with left arrow icon | Reverts `AuthLayout` mode to `"login"` |
| 23 | `AuthFooterNotice` | Footer Text | Bottom text: `"© {year} CovAI Platform. Protected by isolated test sandbox."` | Displays platform copyright and notice |
| 24 | `SuccessCardContainer` | Status Card Container | Centered bordered container displayed when `status === "success"` | Contains post-dispatch feedback elements |
| 25 | `SuccessCardIcon` | Status Icon | Large green `CheckCircle2` icon (w-10 h-10) | Visual confirmation of dispatched request |
| 26 | `SuccessCardHeading` | Text Heading (`<h2>`) | Text: `"Reset Link Dispatched"` | Success state title |
| 27 | `SuccessCardDescription` | Descriptive Text (`<p>`) | Text: `"If an account exists for {email}, you will receive password reset instructions shortly."` | Dispatched notification preserving account privacy |
| 28 | `ReturnToSignInButton` | Action Button | Secondary button with left arrow icon and text `"Return to Sign In"` | Reverts `AuthLayout` mode to `"login"` |
