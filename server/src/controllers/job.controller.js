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