import prisma from "../config/prisma.js";
import { analysisJobResponse } from "../services/analysisResponse.service.js";

const safeNotFound = (res) => res.status(404).json({ success: false, message: "Job not found" });

export const listProjectJobs = async (req, res) => {
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, ownerId: req.user.id }, select: { id: true } });
  if (!project) return safeNotFound(res);
  const jobs = await prisma.job.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" } });
  return res.status(200).json({ success: true, jobs: jobs.map(analysisJobResponse) });
};

export const listUserJobs = async (req, res) => {
  const jobs = await prisma.job.findMany({
    where: { project: { ownerId: req.user.id } }, orderBy: { createdAt: "desc" }, include: { project: { select: { name: true } } },
  });
  return res.status(200).json({ success: true, jobs: jobs.map((job) => ({ ...analysisJobResponse(job), projectName: job.project.name })) });
};

export const getJobDetail = async (req, res) => {
  const job = await prisma.job.findFirst({
    where: { id: req.params.jobId, project: { ownerId: req.user.id } },
    include: { logs: { orderBy: { createdAt: "asc" }, select: { level: true, message: true, createdAt: true } } },
  });
  if (!job) return safeNotFound(res);
  return res.status(200).json({ success: true, job: { ...analysisJobResponse(job), logs: job.logs } });
};
