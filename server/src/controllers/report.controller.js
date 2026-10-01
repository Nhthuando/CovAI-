import prisma from '../config/prisma.js';
import { getIntegrationAnalytics } from '../services/integrationReport.service.js';
import { getIntegrationGuidance } from '../services/integrationGuidance.service.js';

export const getIntegrationReport = async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user.id;

        if (!projectId) {
            return res.status(400).json({ success: false, message: "Missing projectId" });
        }

        const project = await prisma.project.findFirst({
            where: { id: projectId, ownerId: userId }
        });

        if (!project) {
            return res.status(404).json({ success: false, message: "Project not found or unauthorized" });
        }

        const analytics = await getIntegrationAnalytics(projectId);
        
        return res.status(200).json({
            success: true,
            data: analytics
        });
    } catch (error) {
        console.error("[getIntegrationReport]", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getIntegrationGuidanceController = async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user.id;

        if (!projectId) {
            return res.status(400).json({ success: false, message: "Missing projectId" });
        }

        const project = await prisma.project.findFirst({
            where: { id: projectId, ownerId: userId }
        });

        if (!project) {
            return res.status(404).json({ success: false, message: "Project not found or unauthorized" });
        }

        const guidanceResponse = await getIntegrationGuidance(projectId);
        
        return res.status(200).json(guidanceResponse);
    } catch (error) {
        console.error("[getIntegrationGuidanceController]", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
