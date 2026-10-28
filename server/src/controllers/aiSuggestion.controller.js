import * as aiSuggestionService from '../services/aiSuggestion.service.js';

export const getAiSuggestions = async (req, res) => {
    try {
        const { projectId, filePath, functionName } = req.query;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        if (!projectId) {
            return res.status(400).json({ success: false, error: 'projectId is required' });
        }

        const { suggestions, tests } = await aiSuggestionService.getAiSuggestions({
            projectId,
            filePath,
            functionName,
            userId
        });

        return res.status(200).json({
            success: true,
            count: suggestions.length,
            data: { suggestions, tests }
        });
    } catch (error) {
        if (error.status === 404) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }
        if (error.status === 403) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
};

export const refreshAiSuggestions = async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const result = await aiSuggestionService.refreshAiSuggestions({
            projectId,
            userId
        });

        return res.status(200).json({
            success: true,
            message: result.message
        });
    } catch (error) {
        if (error.status === 404) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }
        if (error.status === 403) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
};
