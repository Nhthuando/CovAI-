# Repository Guidelines

## Project Structure

CovAI is a JavaScript monorepo.

- `client/` is the Vite + React 19 SPA: pages in `src/pages/`, reusable UI in `src/components/`, API clients in `src/services/`, and hooks/context in `src/hooks/` and `src/contexts/`.
- `server/` is the Express API. Follow `routes/` -> `controllers/` -> `services/`; put validation in `src/validators/`, middleware in `src/middlewares/`, and helpers in `src/utils/`.
- `server/prisma/` contains the PostgreSQL schema and committed migrations. Tests are in `server/src/tests/` or colocated `*.test.js` files.
- `docker-compose.yml` starts client, server, and Redis. `api.http` contains manual request examples.

Runtime dependencies include PostgreSQL/Prisma, Redis/BullMQ jobs, Firebase Storage, Socket.IO, Gemini, and optional Docker-based analysis.

## Build, Test, and Database Commands

Run from the repository root unless noted:

- `npm run install:all` installs both applications.
- `npm run dev` starts Vite and nodemon together.
- `npm run build --prefix client` builds the frontend.
- `npm run lint --prefix client` runs frontend ESLint.
- `npm test --prefix server` runs the Jest suite.
- `docker compose up --build` starts the containerized stack.

From `server/`, run `npx.cmd prisma validate` and `npx.cmd prisma generate` after Prisma changes. Use `npx.cmd prisma migrate dev` only for reviewed schema changes. `npx.cmd` avoids the current PowerShell execution-policy issue.

## Style and Testing

Use ES modules and match local formatting: client code uses 2 spaces; backend code commonly uses 4. Use PascalCase components (`CoverageDashboard.jsx`), `use`-prefixed hooks, camelCase identifiers, and lowercase feature files such as `coverage.service.js`. Keep frontend API calls in `client/src/services/`.

Jest uses Node and `supertest`. Add behavior-focused `*.test.js` coverage for changed services, routes, authorization, parsing, or fallbacks. There is no backend linter, frontend test suite, coverage threshold, or CI workflow currently configured.

## Security and Pull Requests

Keep secrets in `server/.env`: `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`, Firebase credentials, `GEMINI_API_KEY`, GitHub OAuth keys, email credentials, `ENCRYPTION_KEY`, `CLIENT_URL`, and `ADMIN_EMAILS`. Never commit them.

Protected endpoints must use `authMiddleware` and verify ownership against `req.user.id` for project-derived data. Do not trust client-provided user IDs or Socket.IO room IDs. Review cascade effects and migration SQL before merging.

Use focused commits such as `feat: add coverage export` or `fix: handle missing snapshot`. PRs should describe the user-visible change, note API/schema/configuration changes, link the issue when available, and include screenshots for UI work.
