import express from "express";
import { adminSchemaController } from "../../controllers/admin/adminSchema.controller.js";

const router = express.Router();

// GET /api/admin/schema and /api/admin/schema/models -> List all models grouped by 8 domains
router.get("/", adminSchemaController.getSchemaSummary);
router.get("/models", adminSchemaController.getSchemaSummary);
router.get("/counts", adminSchemaController.getSchemaSummary);

// GET /api/admin/schema/:modelName and /api/admin/schema/models/:modelName -> Single model fields and relations
router.get("/models/:modelName", adminSchemaController.getModelDetail);
router.get("/:modelName", adminSchemaController.getModelDetail);

export default router;
