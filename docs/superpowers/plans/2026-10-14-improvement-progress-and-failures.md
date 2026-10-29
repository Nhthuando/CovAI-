# AI improvement progress and verification feedback

User-authorized outcome: explain actual failed verification and show progress in the existing improvement panel.

1. Summarize verification reports into bounded, sanitized failure details, including baseline/candidate run counts and comparison/regression reasons. Retain the original-file protection.
2. Persist monotonic stage progress: validate, generate, baseline run 1/2, baseline run 2/2, candidate run 1/2, candidate run 2/2, compare, save, complete. Percent reflects stages rather than elapsed-time estimates.
3. Return lightweight job status/progress/latest stage alongside the existing proposal endpoint; render an accessible progress bar and meaningful stage text.
4. Show the failing scenario and concise error on terminal failure, including historical reports without a new summary. Include bounded previous verification feedback when retrying; improve prompt guidance for locators that must survive edit-mode DOM changes.
5. Test safe failure summaries, worker stage mapping and original-file protection; focused frontend lint/build and rendered pending/failure states.
