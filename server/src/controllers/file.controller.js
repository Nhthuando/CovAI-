import { discoverSourceFiles } from '../services/fileDiscovery.service.js';

export const getFiles = (req, res) => {
  try {
    const { rootDir } = req.query;
    if (!rootDir) {
      return res.status(400).json({ error: 'Thiếu tham số rootDir' });
    }
    // Gọi service đã test
    const files = discoverSourceFiles(rootDir);
    res.status(200).json({ success: true, data: files });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
