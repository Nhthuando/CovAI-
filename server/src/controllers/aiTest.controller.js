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
    const tests = await aiTestService.getAllAiTests();
    res.status(200).json(tests);
  } catch (error) {
    console.error('Error fetching AI test results:', error);
    res.status(500).json({ error: 'Failed to fetch AI test results', details: error.message });
  }
};
