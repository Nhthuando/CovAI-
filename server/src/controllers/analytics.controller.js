import * as analyticsService from "../services/analytics.service.js";

export const getDashboardAnalytics = async (req, res) => {
    try {
        const overview = await analyticsService.getSystemOverview();
        const topUsers = await analyticsService.getTopAiUsers(5); // Get top 5 users
        const recentJobs = await analyticsService.getRecentJobs(10); // Get 10 resent jobs

        res.json({
            success: true,
            data: {
                overview,
                topUsers,
                recentJobs
            }
        });
    } catch (error) {
        console.error("Dashboard Analystics Error:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching statistical data"
        });
    }
};