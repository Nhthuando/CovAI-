import prisma from '../config/prisma.js';
import { validateAiSuggestion } from '../validators/aiSuggestion.validation.js';

export const aiSuggestionService = {
  // Lưu gợi ý mới
  async createSuggestion(data) {
    // 1. Validate dữ liệu đầu vào
    const validation = validateAiSuggestion(data);
    
    if (!validation.success) {
      // Trả về lỗi chi tiết nếu validation thất bại
      throw new Error(`Validation failed: ${validation.error.issues.map(e => e.message).join(', ')}`);
    }

    // 2. Lưu vào Database
    try {
      return await prisma.aiSuggestion.create({
        data: validation.data, // Dữ liệu đã được làm sạch và kiểm tra
      });
    } catch (error) {
      console.error("Database error in createSuggestion:", error);
      throw new Error("Could not save AI suggestion to database");
    }
  },

  // Lấy danh sách gợi ý theo Project
  async getSuggestionsByProject(projectId) {
    return await prisma.aiSuggestion.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  },

  // Xóa gợi ý (khi cần làm mới)
  async deleteSuggestionsBySnapshot(snapshotId) {
    return await prisma.aiSuggestion.deleteMany({
      where: { snapshotId },
    });
  }
  
};
