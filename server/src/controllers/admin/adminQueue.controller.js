import { adminQueueService } from "../../services/adminQueue.service.js";
import { ServiceError } from "../../utils/serviceError.js";

class AdminQueueController {
  async getQueuesStatus(req, res) {
    try {
      const status = await adminQueueService.getQueuesStatus();
      return res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error) {
      console.error("[AdminQueueController.getQueuesStatus Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve queue status.",
        code: "QUEUE_STATUS_ERROR",
      });
    }
  }

  async retryAllFailed(req, res) {
    try {
      const { queueName } = req.params;
      const result = await adminQueueService.retryAllFailedJobs(queueName, {
        user: req.user,
        req,
      });

      return res.status(200).json({
        success: true,
        message: `Retried ${result.retriedCount} failed jobs.`,
        data: result,
      });
    } catch (error) {
      console.error("[AdminQueueController.retryAllFailed Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retry jobs in queue.",
        code: "QUEUE_RETRY_ERROR",
      });
    }
  }

  async purgeQueue(req, res) {
    try {
      const { queueName } = req.params;
      const { type, grace } = req.body;

      const result = await adminQueueService.purgeQueue(queueName, { type, grace }, {
        user: req.user,
        req,
      });

      return res.status(200).json({
        success: true,
        message: `Purged ${result.purgedCount} jobs from queue '${queueName}'.`,
        data: result,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error("[AdminQueueController.purgeQueue Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to purge queue.",
        code: "QUEUE_PURGE_ERROR",
      });
    }
  }

  async pauseQueue(req, res) {
    try {
      const { queueName } = req.params;
      const result = await adminQueueService.pauseQueue(queueName, {
        user: req.user,
        req,
      });

      return res.status(200).json({
        success: true,
        message: `Queue '${queueName}' paused.`,
        data: result,
      });
    } catch (error) {
      console.error("[AdminQueueController.pauseQueue Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to pause queue.",
        code: "QUEUE_PAUSE_ERROR",
      });
    }
  }

  async resumeQueue(req, res) {
    try {
      const { queueName } = req.params;
      const result = await adminQueueService.resumeQueue(queueName, {
        user: req.user,
        req,
      });

      return res.status(200).json({
        success: true,
        message: `Queue '${queueName}' resumed.`,
        data: result,
      });
    } catch (error) {
      console.error("[AdminQueueController.resumeQueue Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to resume queue.",
        code: "QUEUE_RESUME_ERROR",
      });
    }
  }
}

export const adminQueueController = new AdminQueueController();
