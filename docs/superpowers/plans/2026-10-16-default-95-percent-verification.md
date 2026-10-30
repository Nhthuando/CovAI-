# Automatic 95% target verification

## Delivered behavior

The default objective is 95% for every nonempty lines, branches, functions and statements counter in configured frontend/backend tiers. 90% is a milestone; there is no percentage selector. Unknown measurements cannot satisfy the target.

Improvement continues from the latest independently verified best candidate, rather than stopping after the first gain. Each accepted addition must pass twice, preserve previous scenarios/assertions, improve measured coverage and avoid regression against the best accepted report. Source scope and denominators are unchanged.

Limits are eight candidate rounds, twelve AI requests including retries and twenty minutes. Three consecutive rounds without verified gain stop the job. A new round requires at least two minutes of remaining budget. Controlled provider/time/request stops retain the verified best result only while ownership, job status, source/test identities and strict apply checks remain valid. User cancellation and lost ownership cannot authorize saving.

## Automated checks

- Final focused backend run: **11 suites, 86 tests passed**. Includes accumulation through 90% to 95%+, rejection of regression against the best report, request exhaustion, provider failure, controlled timeout, cancellation, changed source, lost ownership, feedback retention, coverage provenance and API authorization.
- Chromium UI checks: **4 passed**, covering remaining-time countdown, terminal timeout, responsive layout and automatic target/partial/reached states without a target selector.
- Scoped frontend ESLint and production build passed. The build retains existing bundle-size/dynamic-import warnings.

## Authorized real Food Ordering run

Job: `cmvamwi1q0000d87kqbe3vbr0`.

- Duration: **1,188,722 ms (19m 49s)**.
- Provider: configured `gemini-3.5-flash-lite`.
- Usage: **6 requests; 137,720 reported tokens** (131,950 prompt; 5,770 output).
- Three candidate rounds, **zero accepted rounds**. Generated cart scenarios failed real execution; a repair that swallowed rejected actions was also rejected by static validation.
- Proposal: `FAILED_VERIFICATION`; target stop reason: `NO_FURTHER_GAIN`. The orchestration job completed processing, but this does **not** mean candidate tests passed.
- **95% and 90% were not achieved. No candidate from this run was saved.** Coverage observed during failed candidate runs is not published as an accepted improvement.

Verified retained coverage:

| Tier | Lines | Branches | Functions | Statements |
| --- | ---: | ---: | ---: | ---: |
| Frontend | 48.10% | 33.33% | 24.05% | 44.64% |
| Backend | 59.29% | 29.17% | 39.13% | 57.93% |

Post-run audit confirmed the previously applied three-scenario suite still matches its verified candidate hash, original scenario hashes remain preserved, application source is unchanged, the published assessment matches current test hashes, and all six screenshot files from the two passing runs have valid PNG signatures.

The real worker loaded the target loop before later refinements to attempted-gap rotation, preserving runtime feedback after a rejected repair, prompt guidance to redesign unsupported experiments and terminal error stop reasons. Those refinements passed the focused regression suites; they have **not** been followed by another paid provider run. This evidence establishes target-driven orchestration and safe retention, not a guarantee that this project will reach 95% within one bounded run.
