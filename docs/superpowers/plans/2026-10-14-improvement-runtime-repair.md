# Repeated AI interaction failures

Observed: latest todoapp improvement job contains an empty instruction and repeats an edit locator timeout. Do not require a specific frontend retry path to carry diagnostics.

1. The worker reads the latest failed proposal for the same snapshot, assessment and test file, and supplies bounded verification feedback to generation.
2. When newly added scenarios fail execution, allow one FIX_BREAKPOINT attempt on the temporary candidate. Preserve candidate assertions through the repair validator and all original scenarios through append-only preservation.
3. Re-run the repaired candidate twice; reuse baseline results. Keep the file unchanged unless all execution and comparison gates pass. Existing scenario failures are not eligible for this repair.
4. Show repair/re-verification progress. Test feedback forwarding, one repair maximum, preserved outcomes, successful save and continued failure protection.
