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

/**
 * POST /ai-tests/generate-cypress
 * Queues an AI job to generate Cypress E2E tests with positive, negative,
 * and boundary scenarios for the specified project snapshot.
 */
export const generateCypressTests = async (req, res) => {
  try {
    const { projectId, snapshotId } = req.body;
    const userId = req.user?.id;

    // Validate required fields
    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'projectId is required',
      });
    }

    // Delegate ownership check + job queuing to service
    const job = await aiTestService.queueCypressGeneration({
      projectId,
      snapshotId,
      userId,
    });

    return res.status(202).json({
      success: true,
      message: 'Cypress test generation job queued successfully.',
      jobId: job.id,
      snapshotId: job.snapshotId,
    });
  } catch (error) {
    console.error('[generateCypressTests] Error:', error);
    const statusCode = error.status || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to queue Cypress test generation.',
    });
  }
};
