import { z } from 'zod';

// Định nghĩa schema cho dữ liệu gợi ý AI
export const aiSuggestionSchema = z.object({
  projectId: z.string().cuid({ message: "Invalid Project ID format" }),
  snapshotId: z.string().cuid({ message: "Invalid Snapshot ID format" }),
  filePath: z.string().min(1, "File path is required"),
  functionName: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  message: z.string().min(1, "Message is required"),
});

// Hàm kiểm tra dữ liệu
export const validateAiSuggestion = (data) => {
  return aiSuggestionSchema.safeParse(data);
};
