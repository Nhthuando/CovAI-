import { discoverSourceFiles } from '../services/fileDiscovery.service.js';

export const getFiles = (req, res) => {
  try {
    const { rootDir } = req.query;
    // Validate that rootDir is provided in the query string
    if (!rootDir) {
      return res.status(400).json({ error: 'rootDir parameter is required' });
    }
    // Call the service to get the filtered file list
    const files = discoverSourceFiles(rootDir);
    res.status(200).json({ success: true, data: files });
  } catch (error) {
    // Handle errors and return appropriate status code
    res.status(500).json({ success: false, message: error.message });
  }
};
