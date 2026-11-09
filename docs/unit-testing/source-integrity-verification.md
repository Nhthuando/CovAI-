# Source integrity during test verification

Prepared operation workspaces can borrow installed dependencies through a
`node_modules` symlink (Linux) or directory junction (Windows). Previously, the
source fingerprint inspected symlinks before excluding dependencies. A borrowed
dependency directory could therefore be reported as an escaped source link or
an added source file during the pre-publication check.

The fingerprint now excludes `node_modules` directories and links before
inspecting symlinks, at both the project root and nested package roots. No
additional source or configuration exclusions were added. Source additions,
edits, deletions, unreadable files and links escaping the protected workspace
still block publication.

Publication failures use `SOURCE_INTEGRITY_FAILED` and include file paths and
reasons in the English message. Structured details retain all changed paths and
hashes. Draft validation preserves these diagnostics without exposing file
contents. A failed source check does not create an active test version.

After deploying the backend change, generate and verify a fresh draft. If the
guard still fails, inspect the named files and the test runner's writes before
retrying; do not disable the guard or edit application logic to force a pass.

Validation: source integrity fixtures cover borrowed dependencies, nested
packages, dependency cleanup, actual source additions/edits/deletions, escaping
source links, failed filesystem access, generated coverage/test outputs and
configuration changes. Apply lifecycle tests exercise both dependency linking
and actual source mutation before draft publication.
