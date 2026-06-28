import * as aiTestService from '../services/aiTest.service.js';

export const storeAiTestResult = async (req, res) => {
  try {
    const { aiTestId, status, output, error, duration } = req.body;

    if (!aiTestId || !status) {
      console.error('Validation failed: missing aiTestId or status', req.body);
      return res.status(400).json({ error: 'aiTestId and status are required' });
    }

    const result = await aiTestService.saveAiTestResult({
      aiTestId,
      status,
      output,
      error,
      duration,
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Error storing AI test result:', error);
    res.status(500).json({ error: 'Failed to store AI test result', details: error.message });
  }
};

export const listAiTests = async (req, res) => {
  try {
    const { projectId, page, limit, status } = req.query;
    const userId = req.user?.id;

    if (!projectId) {
      return res.status(400).json({ success: false, message: 'projectId query parameter is required' });
    }

    const result = await aiTestService.getAiTestsList({
      projectId,
      userId,
      page,
      limit,
      status
    });

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching AI test results:', error);
    const statusCode = error.status || 500;
    res.status(statusCode).json({ success: false, message: error.message || 'Failed to fetch AI test results' });
  }
};
