import { randomUUID } from "crypto";
import path from "path";
import { getBucket } from "../config/firebase.js";
import prisma from "../config/prisma.js";
import { scanZipBomb } from "../middlewares/upload.middleware.js";


export const uploadZip = async (req, res) => {
    try {
        const { projectId } = req.body;
        const file = req.file;

        if (!file || !projectId) {
            return res.status(400).json({ message: "Vui lòng cung cấp đủ file zip và projectId." });
        }

        if (!req.user?.id || typeof projectId !== "string" || projectId.trim().length === 0) {
            return res.status(400).json({ message: "projectId không hợp lệ." });
        }

        try {
            await scanZipBomb(file.buffer);
        } catch (scanError) {
            return res.status(400).json({ message: scanError.message });
        }


        const projectExists = await prisma.project.findFirst({
            where: { id: projectId, ownerId: req.user.id },
        });
        if (!projectExists) {
            return res.status(404).json({ message: "Project không tồn tại hoặc không có quyền." });
        }

        const safeOriginalName = path
            .basename(file.originalname)
            .replace(/[^a-zA-Z0-9._-]/g, "_");
        const uniqueFileName = `${randomUUID()}-${safeOriginalName}`;
        const storagePath = `projects/${projectId}/${uniqueFileName}`;
        const blob = getBucket().file(storagePath);

        const blobStream = blob.createWriteStream({
            metadata: { contentType: file.mimetype },
        });

        blobStream.on("error", (err) => {
            return res.status(500).json({ message: "Lỗi khi tải lên Firebase: " + err.message });
        });

        blobStream.on("finish", async () => {
            try {
                const [newSnapshot, newJob] = await prisma.$transaction(async (tx) => {
                    const snapshot = await tx.projectSnapshot.create({
                        data: {
                            projectId,
                            source: "ZIP",
                            storagePath,
                        },
                    });

                    const job = await tx.job.create({
                        data: {
                            projectId,
                            type: "INGEST",
                            status: "QUEUED",
                            snapshotId: snapshot.id,
                            userId: req.user.id,
                        },
                    });

                    return [snapshot, job];
                });

                return res.status(200).json({
                    message: "Upload và đồng bộ hệ thống thành công!",
                    snapshotId: newSnapshot.id,
                    jobStatus: newJob.status,
                    file: {
                        originalName: file.originalname,
                        mimeType: file.mimetype,
                        size: file.size,
                        storagePath,
                    },
                });
            } catch (dbError) {
                console.error("Lỗi Database:", dbError);
                await blob.delete().catch(() => { });
                return res.status(500).json({ message: "Lỗi đồng bộ DB, đã rollback file." });
            }
        });

        blobStream.end(file.buffer);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Có lỗi server!" });
    }
};