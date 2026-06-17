import express from "express";
import {getPlace,getReview,postPlace,getReviewsFromPlace} from "../controllers/placeController.js";
import {authMiddleware} from "../middlewares/authMiddleware.js";
import { ro } from "zod/v4/locales";


const router = express.Router();

router.post("/addPlaces", authMiddleware,postPlace);
router.get("/", authMiddleware,getPlace);
router.get("/:placeId/fetch-reviews", authMiddleware,getReview);
router.get("/:placeId/reviews", authMiddleware ,getReviewsFromPlace);

export default router;