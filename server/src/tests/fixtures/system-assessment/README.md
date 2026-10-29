# Evidence fixture

This fixture is a real Vite/React frontend, Node HTTP API and disposable PostgreSQL-backed item store. `requirements.json` supplies explicit test outcomes; source behavior is not used to approve those outcomes automatically.

`strong.spec.js` asserts creation, persistence and invalid-input rejection. `weak.spec.js` only checks page visibility. `server/src/unvisited.js` and `client/src/lazy.jsx` deliberately remain unloaded and must remain in coverage denominators.

Run only in an execution workspace using `.covai/system-test.json`; never point it at a production database. A fault changing `name.trim().length > 0` to `>= 0` should fail the rejection assertion. Smoke-only execution must not be credited with detecting this fault.
