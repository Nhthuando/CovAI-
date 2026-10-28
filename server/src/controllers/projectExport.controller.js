import { parseExportQuery } from "../validators/projectExport.validation.js";
import { loadExportScope, collectAnalysisExport, exportFilename } from "../services/projectExport.service.js";
import { createProjectArchive } from "../services/projectArchive.service.js";
import { renderAnalysisPdf } from "../services/analysisPdf.service.js";
import { snapshotWorkspaceRoot } from "../utils/snapshotWorkspace.js";
import { ServiceError } from "../utils/serviceError.js";

// Keep concurrent memory-heavy ZIP/PDF generation bounded per server process.
let activeExports = 0;
const MAX_ACTIVE_EXPORTS = 2;

export const downloadProjectExport = async (req, res) => {
    let acquired = false;
    try {
        const query = parseExportQuery(req.query);
        const scope = await loadExportScope({ projectId: req.params.id, snapshotId: query.snapshotId, userId: req.user?.id });
        if (activeExports >= MAX_ACTIVE_EXPORTS) {
            res.setHeader("Retry-After", "10");
            throw new ServiceError("Other exports are being prepared. Please try again shortly.", 429);
        }
        activeExports++; acquired = true;
        let buffer, contentType;
        if (query.type === "project") {
            const archive = await createProjectArchive(snapshotWorkspaceRoot(scope.snapshot));
            buffer = archive.buffer; contentType = "application/zip";
        } else {
            const report = await collectAnalysisExport(scope);
            const json = JSON.stringify(report, null, 2);
            if (Buffer.byteLength(json) > 25 * 1024 * 1024) throw new ServiceError("Analysis export exceeds 25 MiB. Export a smaller snapshot.", 413);
            if (query.format === "json") { buffer = Buffer.from(json); contentType = "application/json; charset=utf-8"; }
            else { buffer = await renderAnalysisPdf(report); contentType = "application/pdf"; }
        }
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Disposition", `attachment; filename="${exportFilename(scope.project, scope.snapshot, query.format)}"`);
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", buffer.length);
        return res.status(200).send(buffer);
    } catch (error) {
        if (error instanceof ServiceError) return res.status(error.statusCode).json({ success: false, message: error.message });
        console.error("[ProjectExport] Export failed:", error.name);
        return res.status(500).json({ success: false, message: "Could not prepare export. Please try again." });
    } finally { if (acquired) activeExports--; }
};
