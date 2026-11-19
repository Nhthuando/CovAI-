const path = require("path");
const fs = require("fs");

module.exports = function (request, options) {
  try {
    return options.defaultResolver(request, options);
  } catch (err) {
    // If Jest's moduleNameMapper stripped .js from a relative virtual mock target (e.g. ../lib/prisma),
    // return the resolved path so Jest does not throw createNoMappedModuleFoundError before virtual mocks take effect.
    if (request.startsWith(".") || path.isAbsolute(request)) {
      const resolved = path.resolve(options.basedir, request);
      const exts = options.extensions || [".js", ".ts", ".tsx", ".jsx", ".json", ".mjs", ".cjs"];
      for (const ext of ["", ...exts]) {
        const candidate = resolved + ext;
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
          }
        } catch (_) {}
      }
      return resolved;
    }
    throw err;
  }
};
