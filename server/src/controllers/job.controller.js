import { createHash } from "crypto";
import path from "path";
import { randomUUID } from "crypto";
import { getBucket } from "../config/firebase.js";
import prisma from "../config/prisma.js";
import { scanArchiveBomb } from "../middlewares/upload.middleware.js";
import { addJobToQueue } from "../services/queue.service.js";
import { createSnapshotIngestJob } from "../services/job.service.js";
import { ServiceError } from "../utils/serviceError.js";

export const listProjectJobs = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId)
      return res.status(401).json({ message: "Không thể lấy user Id!" });

    const { projectId } = req.params;
    if (!projectId)
      return res.status(400).json({ message: "Thiếu projectId!" });

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        ownerId: userId,
      },
    });

    if (!project) {
      return res
        .status(404)
        .json({
          message: "Không tìm thấy Project hoặc Project không thuộc về user!",
        });
    }

    const jobs = await prisma.job.findMany({
      where: { projectId: projectId },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      success: true,
      message: "GET Job thành công!",
      jobs,
    });
  } catch (error) {
    console.error("[listProjectJobs] Error:", error);
    return res.status(500).json({ success: false, message: "Có lỗi server!" });
  }
};

export const listUserJobs = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId)
      return res.status(401).json({ message: "Không thể lấy user Id!" });
    const jobs = await prisma.job.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        project: { select: { name: true } },
      },
    });
    return res
      .status(200)
      .json({ message: "GET toàn bộ Job thành công!", jobs });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Có lỗi server!" });
  }
};

export const getJobDetail = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId)
      return res.status(401).json({ message: "Không thể lấy user id!" });
    const { jobId } = req.params;
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        payloadJson: true,
        resultJson: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
        userId: true,
        logs: true,
        output: true,
      },
    });

    if (!job) return res.status(404).json({ message: "Job không tồn tại!" });
    if (job.userId !== userId)
      return res.status(403).json({ message: "Job không thuộc về user!" });

    return res.status(200).json({
      message: "GET Job Detail thành công",
      job: {
        ...job,
        payload: job.payloadJson ? JSON.parse(job.payloadJson) : null,
        result: job.resultJson ? JSON.parse(job.resultJson) : null,
        payloadJson: undefined,
        resultJson: undefined,
        userId: undefined,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Có lỗi server!" });
  }
};

/**
 * SCRUM-73: Tạo Ingest Job
 * Nhận file ZIP, upload lên Firebase, tạo Snapshot + Job QUEUED,
 * sau đó kick-off pipeline xử lý bất đồng bộ (không await).
 *
 * Route: POST /api/job/:projectId/ingest
 * Middleware: authMiddleware, uploadSingleZip
 */
export const ingestJob = async (req, res) => {
  try {
    // ── Validate auth ──────────────────────────────────────────────────
    if (!req.user?.id) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const userId = req.user.id;
    const { projectId } = req.params;
    const file = req.file;

    // ── Validate input ─────────────────────────────────────────────────
    if (!file) {
      return res.status(400).json({ message: "Vui lòng upload file .zip." });
    }
    if (
      !projectId ||
      typeof projectId !== "string" ||
      projectId.trim().length === 0
    ) {
      return res.status(400).json({ message: "projectId không hợp lệ." });
    }

    // ── Scan archive bomb trước khi làm bất cứ điều gì ────────────────────
    try {
      await scanArchiveBomb(file.buffer, file.originalname);
    } catch (scanError) {
      return res.status(400).json({ message: scanError.message });
    }

    // ── Kiểm tra project tồn tại và thuộc về user ─────────────────────
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: userId },
    });
    if (!project) {
      return res
        .status(404)
        .json({
          message: "Project không tồn tại hoặc bạn không có quyền truy cập.",
        });
    }

    // ── Tính checksum để phát hiện snapshot trùng lặp ─────────────────
    const checksum = createHash("sha256").update(file.buffer).digest("hex");
    const existingSnapshot = await prisma.projectSnapshot.findFirst({
      where: { projectId, checksum },
    });
    if (existingSnapshot) {
      return res
        .status(409)
        .json({
          message:
            "Source code này đã được import trước đó (duplicate snapshot).",
        });
    }

    // ── Upload file ZIP lên Firebase Storage ──────────────────────────
    const safeOriginalName = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueFileName = `${randomUUID()}-${safeOriginalName}`;
    const storagePath = `projects/${projectId}/${uniqueFileName}`;
    const blob = getBucket().file(storagePath);

    const blobStream = blob.createWriteStream({
      metadata: { contentType: file.mimetype },
    });

    // Upload error handler
    blobStream.on("error", (err) => {
      if (!res.headersSent) {
        res
          .status(500)
          .json({
            message: "Lỗi khi upload file lên Firebase: " + err.message,
          });
      }
    });

    // Upload finish handler
    blobStream.on("finish", async () => {
      try {
        // ── SCRUM-73: Tạo ProjectSnapshot + Job QUEUED trong 1 transaction ──
        const { snapshot, job } = await createSnapshotIngestJob({
          projectId,
          userId,
          checksum,
          storagePath,
        });

        // ── SCRUM-74, 76, 77, 78: Kick-off pipeline bất đồng bộ ──────────
        // KHÔNG dùng await → API trả về ngay, worker xử lý ngầm
        addJobToQueue("INGEST", job.id).catch((err) => {
          console.error("Lỗi khi thêm INGEST vào queue:", err);
        });

        // ── Trả về kết quả ngay cho Frontend ─────────────────────────────
        return res.status(200).json({
          message:
            "Đã tiếp nhận yêu cầu import source code! Job đang được xử lý.",
          snapshotId: snapshot.id,
          jobId: job.id,
          jobStatus: job.status, // "QUEUED"
          progress: job.progress, // 0
          file: {
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            storagePath,
          },
        });
      } catch (dbError) {
        console.error("[IngestJob] Lỗi Database sau khi upload:", dbError);
        // Rollback: xóa file đã upload nếu DB lỗi
        await blob.delete().catch(() => {});
        if (dbError instanceof ServiceError) {
          return res
            .status(dbError.statusCode)
            .json({ message: dbError.message });
        }
        return res
          .status(500)
          .json({ message: "Lỗi lưu dữ liệu, đã rollback file upload." });
      }
    });

    // Bắt đầu stream upload
    blobStream.end(file.buffer);
  } catch (error) {
    console.error("[IngestJob] Lỗi server:", error);
    if (error instanceof ServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: "Có lỗi server!" });
  }
};
