# Full-system test generation and English results

Goal: System Test offers real full-system execution only, an English results interface, and generated tests verified against the current imported snapshot.

Architecture: A dedicated generator collects fresh source/configuration and a live browser observation from the isolated application. It runs generated Playwright code on fresh databases, supplies real errors/page snapshots to Gemini for up to two repairs, and persists only verified code. Unsupported or incomplete startup configuration fails explicitly. Verification demonstrates execution, not universal correctness or complete business coverage.

Constraints: Preserve existing unrelated changes. No mocks or fallback to frontend-only execution from public System Test. English UI/test titles; preserve imported application's actual labels. Never send env credentials, dependency/generated directories, or browser cookies to Gemini.

- [x] Replace mode selector with a fixed Full system label, simplify toolbar and provide separate Evidence column with compact previews and accessible modal.
- [x] Make public System Test jobs and AI generation require full mode; retain historical results without presenting them as new full runs.
- [x] Collect bounded fresh source (UI components, server routes, package scripts and schema) and current runtime accessible structure; report omissions.
- [x] Implement bounded generation/repair with safety/assertion validation, real dry-run feedback, no persistence on failure and fresh verification before save.
- [x] Test context boundaries, repair flow, unsupported config and persistence gates; build and inspect English UI in browser; generate and run todoapp through Gemini without manual edits.
