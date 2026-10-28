# AI improvement selector failure repair

Observed latest Todo application proposal: baseline passed twice; additional Edit scenario failed twice waiting for a guessed `svg.lucide-edit2`. Its next action also reused a row filtered by title after edit mode removed that text.

- [x] Capture rendered control metadata, including actual SVG classes, on managed Playwright failure. Keep input values out of diagnostic metadata.
- [x] Read bounded inline/file-backed evidence before temporary workspaces are released; reject paths outside the workspace.
- [x] Keep the short UI failure summary separate from detailed AI repair feedback.
- [x] Retain selected source gaps during repair and explain icon aliases and mutable row/form filters.
- [x] Limit repair to new scenarios in the selected file; preserve original scenarios and candidate assertions, and keep two-run verification before apply.
- [x] Verify feedback, parser, proposal safety, fixture loading, and related assessment/navigation behavior through Jest.

Validation: 69 related Jest tests passed. A local Chromium run reproduced the incorrect SVG selector failure and captured the actual icon class through the generated fixture, report parser, and model feedback. The corrected Edit interaction passed two separate browser runs, including submit after the title changed. The local reproduction used a small DOM fixture; this does not establish live AI generation success.

The user explicitly authorized live replay. Job `cmv9h3chz0000m47kgs3u0vjl` retained the original file after its generated Edit scenario still failed: a generic SVG filter plus `nth(0)` clicked the status button. Runtime evidence showed the actual Edit icon classes were `lucide lucide-pen lucide-edit-2`. The booster guidance now explicitly prefers exact observed icon classes over generic SVG indexes and warns against masking a wrong click with alternative input locators.

Live rerun `cmv9hgimu0000v47kg3cmg48g` passed both baseline runs and both candidate runs, remained comparable with no regression, and reached `APPLIED`. It added Toggle and Delete tests; it did not include Edit, so this result does not establish a live Edit scenario pass. Coverage counter deltas: backend +15 lines, +3 branches, +2 functions, +15 statements; frontend +8 lines, +6 branches, +6 functions, +10 statements.

Post-apply assessment `cmv9hlus30002cg7kb2owx5ht` completed with 5/5 tests passing in each of two independent runs. Its source and test hashes match the saved snapshot. No additional business correctness is inferred from these measurements.
