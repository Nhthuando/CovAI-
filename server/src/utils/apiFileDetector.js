/**
 * Helper to determine whether a given file path corresponds to an API endpoint,
 * route, controller, or server/app entry point (excluded from Unit test coverage).
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export const isApiFilePath = (filePath = "") => {
    if (!filePath) return false;
    const norm = filePath.replace(/\\/g, "/").toLowerCase();
    return (
        /(^|\/)(routes?|controllers?|endpoints?|api)(\/|\.|$)/i.test(norm) ||
        /\.(route|routes|controller|controllers)\.[cm]?[jt]sx?$/i.test(norm) ||
        /(^|\/)(app|server)\.[cm]?[jt]sx?$/i.test(norm) ||
        /^(src\/)?(index|main)\.[cm]?[jt]sx?$/i.test(norm.replace(/^\.?\//, ""))
    );
};
