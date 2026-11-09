export const DEPENDENCY_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
// Leave room for validation, result publication and submitting the test rerun.
export const DEPENDENCY_INSTALL_REQUEST_TIMEOUT_MS = DEPENDENCY_INSTALL_TIMEOUT_MS + 60 * 1000;
