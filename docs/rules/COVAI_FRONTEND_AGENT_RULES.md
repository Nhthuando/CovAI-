CovAI Frontend UI/UX Agent Rules

Scope: These rules apply to all frontend code in the
CovAI/TestCovAI project.
Any AI agent that creates, edits, refactors, or reviews UI code MUST
follow these rules.

1. Core Design Direction

CovAI must look like a professional developer tool / engineering
platform, not a generic AI-generated landing page.

The interface should feel: - Clean - Technical - Minimal - Consistent -
Dense enough for developer workflows - Easy to scan - Predictable across
pages

Strictly forbidden

DO NOT use gradients / linear-gradient / radial-gradient /
conic-gradient for backgrounds, buttons, cards, text, borders,
icons, or decorative effects.

Do not use excessive glow, neon, blur, glassmorphism, floating
blobs, abstract AI waves, or decorative light effects.

Do not create oversized marketing-style headings inside application
pages.

Do not use random colors for individual cards/features.

Do not invent a new visual style for each page.

Do not add decorative UI that has no functional purpose.

Avoid excessive rounded corners. CovAI is a developer tool, not a
playful consumer app.

Avoid excessive shadows. Prefer borders and surface hierarchy.

2. Color System

All colors MUST come from shared design tokens/CSS variables.

Never hardcode arbitrary colors inside individual components unless
there is a documented exceptional reason.

Primary palette

:root {
  /* Brand */
  --color-primary: #6D5DFB;
  --color-primary-hover: #5B4BE7;
  --color-primary-active: #4C3FD0;

  /* Secondary */
  --color-secondary: #2563EB;
  --color-secondary-hover: #1D4ED8;

  /* Semantic */
  --color-success: #16A34A;
  --color-warning: #D97706;
  --color-danger: #DC2626;
  --color-info: #0284C7;

  /* Light theme */
  --color-bg: #FFFFFF;
  --color-surface: #F8FAFC;
  --color-surface-secondary: #F1F5F9;
  --color-border: #E2E8F0;

  --color-text: #0F172A;
  --color-text-secondary: #475569;
  --color-text-muted: #64748B;

  /* Interactive */
  --color-focus: #6D5DFB;
}

Dark theme

[data-theme="dark"] {
  --color-bg: #0B0F14;
  --color-surface: #11161D;
  --color-surface-secondary: #171D25;
  --color-border: #29313D;

  --color-text: #F8FAFC;
  --color-text-secondary: #CBD5E1;
  --color-text-muted: #94A3B8;

  --color-primary: #8B7CFD;
  --color-primary-hover: #9D91FE;
  --color-primary-active: #7567EA;

  --color-secondary: #60A5FA;
  --color-secondary-hover: #93C5FD;

  --color-success: #22C55E;
  --color-warning: #F59E0B;
  --color-danger: #EF4444;
  --color-info: #38BDF8;

  --color-focus: #8B7CFD;
}

Color usage rules

Primary = main actions, selected navigation, important interactive
state.

Secondary = supporting actions/information.

Success = successful test/job/status only.

Warning = warning or attention state only.

Danger = errors, destructive actions, failed tests/jobs only.

Info = informational state only.

Do not use semantic colors merely for decoration.

Body text must have sufficient contrast against its background.

A component must work correctly in both light and dark themes.

3. Theme Architecture --- Light / Dark / System

The application MUST be designed from the beginning to support:

light

dark

system

Do not build a dark-only UI and attempt to retrofit light mode later.

Required behavior

light: always use light theme.

dark: always use dark theme.

system: follow prefers-color-scheme.

Persist the user's explicit preference in local storage or the
project's existing preference store.

When system is selected, react to OS theme changes when practical.

Prevent or minimize theme flash during initial page load.

Theme selection must be globally accessible, preferably from
user/settings UI.

Recommended value:

type ThemeMode = "light" | "dark" | "system";

Components MUST use semantic theme tokens such as:

background: var(--color-surface);
color: var(--color-text);
border-color: var(--color-border);

Do NOT implement components with assumptions such as:

background: #111827;
color: white;

4. Typography

Use one primary sans-serif family across the application.

Recommended stack:

font-family:
  Inter,
  ui-sans-serif,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;

For source code, file paths, logs, test output, terminal-like content,
IDs, and code-related values:

font-family:
  "JetBrains Mono",
  "SFMono-Regular",
  Consolas,
  monospace;

Rules: - Do not randomly mix serif and sans-serif fonts. - Page titles
should be clear, not gigantic. - Prefer font weight and spacing over
decorative typography. - Keep heading hierarchy consistent across all
pages.

Suggested hierarchy: - Page title: 28--32px - Section title: 20--24px -
Card title: 16--18px - Body: 14--16px - Secondary/meta text: 12--14px

5. Spacing & Layout

Use a consistent spacing scale:

4, 8, 12, 16, 20, 24, 32, 40, 48, 64px

Prefer multiples of 4px.

Rules: - Pages must use a shared application container/layout. - Similar
pages must have the same content width and horizontal padding. - Cards
in the same group should align. - Forms should have predictable
label/input spacing. - Do not place elements at arbitrary positions just
to fill empty space. - Developer workflows may be information-dense, but
must remain readable.

Suggested desktop content width:

max-width: 1440px;

Workspace/editor screens may intentionally use the full viewport.

6. Border Radius & Shadows

Use a small, controlled radius system:

--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;
--radius-xl: 12px;

Rules: - Buttons/inputs: usually 6px. - Cards/panels: usually 8px. -
Modals: up to 12px. - Avoid pill shapes unless the element is actually
a badge/tag/status/filter. - Do not use 20px+ rounded cards
everywhere.

Shadows should be subtle and rare.

Prefer:

surface difference + 1px border

over large blurred shadows.

7. Component Consistency

Before creating a new component, check whether the project already
contains an equivalent reusable component.

Shared components should exist for common patterns such as:

Button
IconButton
Input
Textarea
Select
Checkbox
Radio
Switch
Badge
StatusBadge
Tooltip
Dropdown
Tabs
Card
Modal/Dialog
Drawer
Table
Pagination
Breadcrumb
EmptyState
Skeleton
Spinner
Toast
ThemeSelector
PageHeader

Do not create ProjectButton, CoverageButton, AIButton, etc. when
the difference can be represented by props/variants.

Example:

<Button variant="primary">Run Analysis</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger">Delete Project</Button>

8. Navigation Is Mandatory

Every new page/screen MUST have a valid way to navigate to it.

Creating a route alone is NOT considered complete.

Whenever an agent creates a page, it must also determine how the user
reaches it through the UI.

Examples: - Sidebar item - Header navigation - Project card action -
Button - Dropdown menu - Breadcrumb - Tabs - Contextual link

Navigation rules

Before considering a UI task finished, verify:

1. Route exists.
2. A user-visible navigation path to the route exists.
3. User can navigate back or to the parent context.
4. Active navigation state is visible where relevant.
5. Refreshing the URL does not break the page.
6. Navigation does not require manually typing the URL.

No orphan pages.

For nested pages, prefer breadcrumbs:

Projects / Online Food Ordering / Coverage
Projects / Online Food Ordering / AI Tests

9. Application Structure

The authenticated application should use a consistent shell.

Recommended structure:

AppShell
├── Sidebar / Primary Navigation
├── Topbar
└── Main Content
    ├── Breadcrumb (when applicable)
    ├── PageHeader
    └── Page Content

Workspace/editor screens may use:

WorkspaceShell
├── Activity Bar
├── Explorer
├── Editor/Main Workspace
├── AI Assistant / Inspector
└── Status Bar

Do not redesign these structural regions independently on each route.

10. Buttons & Actions

Every action must have clear hierarchy.

Primary button

Use for the single most important action in a region.

Examples: - New Project - Run Analysis - Generate Tests - Save

Secondary button

Use for supporting actions.

Danger button

Only for destructive actions.

Rules: - Do not place multiple visually competing primary buttons in the
same small region. - Icon-only buttons require accessible
labels/tooltips. - Disabled buttons must visibly appear disabled. -
Loading actions must show loading state and prevent accidental duplicate
submissions. - Button hover must not transform into a completely
different color style.

11. Forms

Forms must include: - Visible labels - Validation feedback - Error
state - Disabled state where needed - Loading/submitting state - Clear
required-field indication when relevant

Do not rely on placeholder text as the only label.

Error messages should explain what the user can correct.

12. Cards, Panels & Dashboard Metrics

Cards are for grouping related information, not for decorating every
piece of text.

Dashboard metrics should follow one shared pattern:

Label
Primary value
Optional supporting text/status

Avoid: - Different background color for every metric - Random icon
colors - Unnecessary glow - Oversized numbers without context

13. Tables & Data-Heavy Screens

CovAI contains projects, coverage data, tests, jobs, files, AI
generations, frameworks, and analysis results. Prefer tables/lists where
users need comparison.

Tables should support when applicable: - Clear column headings - Row
hover - Sorting - Filtering - Pagination - Empty state - Loading state -
Error state - Responsive overflow - Row actions

Do not convert naturally tabular engineering data into a collection of
oversized cards solely for visual appearance.

14. Code / Coverage / Testing UI

Engineering information should prioritize readability over decoration.

Coverage metrics should clearly distinguish: - Statements - Branches -
Functions - Lines

Test states should use consistent semantics: - Passed → success - Failed
→ danger - Running → info/neutral activity - Skipped → muted/warning
where appropriate

Code editors, CFG viewers, coverage viewers, and logs must preserve
space for actual technical content.

Do not surround every technical value with decorative boxes.

15. AI Features

AI is a feature of CovAI, not the visual theme of the entire
application.

Do NOT make every AI feature: - Purple glowing - Gradient-filled -
Sparkling - Floating - Neon

AI actions should use the same design system as normal application
actions.

A small AI icon/badge may identify AI-powered functionality, but the
interface should still look like a serious testing/developer platform.

AI-generated output must be visually distinguishable from user/source
data when that distinction matters.

16. States Are Required

Any component that depends on asynchronous data should consider:

Loading
Success
Empty
Error
Disabled
Permission denied (when applicable)

Do not render a blank page while data is loading.

Examples:

No projects yet
No coverage data available
No tests detected
Analysis failed
AI generation in progress

17. Responsive Design

All normal pages must support at least: - Desktop - Tablet - Mobile
where the workflow reasonably permits it

Recommended breakpoints:

sm: 640px
md: 768px
lg: 1024px
xl: 1280px
2xl: 1536px

Rules: - No accidental horizontal page overflow. - Tables may use
controlled horizontal scrolling. - Sidebar should collapse/drawer on
smaller screens. - Workspace/editor can prioritize desktop but must
degrade gracefully.

18. Accessibility

At minimum: - Use semantic HTML. - Buttons must be <button>,
navigation links should be links. - Inputs must have labels. -
Interactive controls must be keyboard accessible. - Maintain visible
focus states. - Icons used as controls need accessible names. - Do not
communicate state using color alone. - Maintain reasonable
text/background contrast.

Never remove focus outlines without providing a visible replacement.

19. Icons

Use one icon library consistently.

Do not mix several icon styles unless required by an external
integration logo.

Rules: - Same icon size for equivalent controls. - Do not use emojis as
application UI icons. - Icons should support meaning, not decorate every
line of text.

20. Motion & Animation

Animation should communicate state, not show off.

Allowed: - Small hover transitions - Modal/dropdown transitions -
Loading indicators - Sidebar transition - Small state transitions

Avoid: - Large entrance animations - Constant floating - Parallax -
Background animation - Text animation - Excessive spring effects

Suggested transition:

transition: background-color 150ms ease,
            border-color 150ms ease,
            color 150ms ease,
            opacity 150ms ease;

Respect prefers-reduced-motion where applicable.

21. Landing Page vs Application UI

The public landing page and authenticated product may have different
layouts, but they MUST share: - Brand colors - Typography - Buttons -
Radius philosophy - Icon style - Theme principles

The landing page must also avoid the generic "AI startup" look: - No
gradients - No abstract glowing waves - No huge serif/italic AI headline
combinations - No fake social-proof elements unless backed by real data

Focus the landing page on CovAI's real capabilities.

22. Content Rules

UI text should be concise and functional.

Prefer:

Run Coverage
Generate Tests
Import Repository
Analysis Failed
No Tests Detected

Avoid unnecessary marketing language inside the product.

Do not invent statistics such as:

200+ developers
99% accuracy
10x faster

unless the project has evidence for those claims.

23. No Fake Data in Production UI

Do not hardcode fake: - Coverage percentages - Number of projects - User
counts - AI status - Test counts - Framework support status - Activity
history

Use API data, explicit demo fixtures, or meaningful empty states.

Demo/mock data must be clearly isolated from production behavior.

24. Destructive Actions

Deleting projects, tests, snapshots, integrations, or other important
resources should require appropriate confirmation.

Confirmation should clearly state what will be deleted.

Do not use a primary-colored button for destructive confirmation.

25. Tailwind CSS — Required UI Styling Library

Tailwind CSS is the standard styling library for the CovAI frontend.

When creating or modifying UI, prefer Tailwind CSS utility classes and the project's existing Tailwind configuration instead of writing separate component-specific CSS.

Required

Use Tailwind CSS for layout, spacing, typography, colors, borders, radius, responsive behavior, states, and transitions.

Centralize CovAI design tokens in the Tailwind theme/configuration and/or global CSS variables.

Use semantic theme tokens rather than hardcoded colors.

Reuse Tailwind utility patterns consistently across the application.

Extract repeated UI patterns into reusable React components.

Use responsive Tailwind breakpoints consistently.

Use Tailwind state variants such as hover:, focus:, focus-visible:, disabled:, and data-* where appropriate.

Support the project's light / dark / system theme architecture without creating a second independent theme system.

Prefer Tailwind's spacing scale instead of arbitrary spacing values.

Forbidden / Avoid

Do NOT introduce another UI styling library such as:

Bootstrap
Material UI
Chakra UI
Ant Design
styled-components
Emotion

unless an existing project dependency specifically requires it.

Avoid excessive arbitrary values:

mt-[13px]
px-[17px]
bg-[#171923]
w-[437px]

Prefer shared design tokens:

mt-3
px-4
bg-surface
w-full

Arbitrary values are acceptable only when a real design/technical requirement cannot be represented by the existing design tokens.

Tailwind + Design Tokens

Tailwind must consume the CovAI design system rather than replacing it.

Conceptually:

:root {
  --color-bg: #FFFFFF;
  --color-surface: #F8FAFC;
  --color-border: #E2E8F0;
  --color-text: #0F172A;
  --color-text-secondary: #475569;
  --color-primary: #6D5DFB;
}

[data-theme="dark"] {
  --color-bg: #0B0F14;
  --color-surface: #11161D;
  --color-border: #29313D;
  --color-text: #F8FAFC;
  --color-text-secondary: #CBD5E1;
  --color-primary: #8B7CFD;
}

Components should consume these semantic tokens through Tailwind/configuration rather than inventing new colors.

Example:

<Button variant="primary">Run Analysis</Button>

The shared Button component should internally use the configured Tailwind tokens.

Reusable Tailwind Components

Do not repeat giant Tailwind class strings across many files.

Prefer reusable components:

Button
Card
Input
Modal
Badge
Table
Tabs
Dropdown
PageHeader
StatusBadge
ThemeSelector

Example:

<Button variant="primary">Save</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger">Delete</Button>

Tailwind Configuration

Before adding UI styles, inspect the project's existing:

tailwind.config.*
@theme
globals.css
index.css

depending on the Tailwind version used by the project.

Do not create a second competing color, spacing, typography, or radius system.

If a new design token is genuinely required, add it to the central design system, not only to one component.

Gradient Rule

Tailwind gradient utilities are forbidden in CovAI UI:

bg-gradient-to-*
from-*
via-*
to-*

Do not use gradients for:

Backgrounds

Buttons

Text

Cards

Borders

Hero sections

Decorative effects

CovAI uses solid colors and semantic design tokens.

Dark / Light Theme

Tailwind must work with:

light
dark
system

A component must not invent arbitrary theme colors such as:

bg-white dark:bg-[#121212]

when those values belong to the central design system.

Prefer semantic classes configured by the project:

bg-background text-foreground border-border

The exact token names must follow the project's existing Tailwind configuration.

Final Tailwind Rule

Use Tailwind as the implementation tool, but use the CovAI Design System as the source of truth.

Do not let Tailwind utilities become an excuse for:

Random colors

Random spacing

Random radius

Page-specific visual styles

Gradient-heavy AI aesthetics

Duplicated component styles

26. Refactoring Existing AI-Styled UI

When modifying an existing page, the agent should actively remove
inconsistent AI-generated visual patterns.

Refactor: - Gradients → solid semantic colors - Glowing borders → normal
borders/focus states - Random purple/cyan combinations → design tokens -
Huge rounded cards → standard radius - Excessive card layouts →
appropriate tables/lists/panels - Random spacing → shared spacing
scale - Page-specific buttons → shared button variants - Dark-only
hardcoded colors → theme variables - Orphan routes → real navigation
entry points

Do not preserve bad visual patterns merely because they already exist.

27. Page Implementation Checklist

Before finishing ANY frontend page, verify:

Uses shared application layout.

Uses design-system colors only.

Contains no gradients.

Works in light mode.

Works in dark mode.

Works with system theme.

Typography matches the rest of CovAI.

Spacing follows shared scale.

Reuses existing components where possible.

Has loading state when required.

Has empty state when required.

Has error state when required.

Has responsive behavior.

Has keyboard/focus accessibility.

Route is registered.

There is a visible navigation path to the page.

User can return to the parent/previous context.

No fake statistics/content were invented.

No unnecessary AI-style glow/decorations were introduced.

28. Rules for AI Coding Agents

When receiving a frontend task, the agent MUST follow this process:

Step 1 --- Inspect before coding

Inspect: - Existing layout - Existing reusable components - Existing
routing - Existing theme implementation - Existing CSS/Tailwind
configuration - Similar pages

Do not immediately generate a new standalone visual style.

Step 2 --- Reuse

Prefer existing: - Layout - Components - Tokens - Hooks - Routing
conventions - API patterns

Step 3 --- Consider navigation

Ask internally:

How does the user reach this feature from the existing interface?

If no path exists, add an appropriate navigation entry as part of the
implementation.

Step 4 --- Consider all themes

Any new color or component must be checked against: - Light - Dark -
System

Step 5 --- Implement states

Handle relevant loading/error/empty/success states.

Step 6 --- Review consistency

Compare the result with neighboring pages/components.

If the new UI looks like it belongs to a different product, refactor it.

29. Design Principle

When choosing between:

"More visually impressive"

and

"More consistent, clear, maintainable, and usable"

always choose the second option.

CovAI should visually communicate:

Software testing and engineering platform first. AI-assisted
second.

The UI must feel intentionally designed by one product team, not
independently generated page-by-page by different AI prompts.