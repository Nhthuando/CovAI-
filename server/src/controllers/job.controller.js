import prisma from "../config/prisma.js";

export const listProjectJobs = async (req, res) => {
    try {
        const userId = req.user.id;
        if (!userId) return res.status(401).json({ message: "Không thể lấy user Id!" });
        const { projectId } = req.params;
        const project = await prisma.project.findFirst({ where: { ownerId: userId, id: projectId } });
        if (!project) return res.status(404).json({ message: "Không tìm thấy Project hoặc Project không thuộc về user!" });
        const jobs = await prisma.job.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
        return res.status(200).json({ message: "GET Job thành công!", jobs });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Có lỗi server!" });
    }
}

export const getJobDetail = async (req, res) => {
    try {
        const userId = req.user.id;
        if (!userId) return res.status(401).json({ message: "Không thể lấy user id!" });
        const { jobId } = req.params;
        const job = await prisma.job.findUnique({
            where: { id: jobId },
            select: {
                id: true, type: true, status: true, progress: true,
                payloadJson: true, resultJson: true, errorMessage: true,
                startedAt: true, finishedAt: true,
                userId: true,
                logs: true, output: true,
            }
        });

        if (!job) return res.status(404).json({ message: "Job không tồn tại!" });
        if (job.userId !== userId) return res.status(403).json({ message: "Job không thuộc về user!" });

        return res.status(200).json({
            message: "GET Job Detail thành công",
            job: {
                ...job,
                payload: job.payloadJson ? JSON.parse(job.payloadJson) : null,
                result: job.resultJson ? JSON.parse(job.resultJson) : null,
                payloadJson: undefined,
                resultJson: undefined,
                userId: undefined,
            }
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ message: "Có lỗi server!" })
    }
}