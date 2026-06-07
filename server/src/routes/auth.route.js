import express from "express";
import {login,register, oAuthGithub} from "../controllers/auth.controller.js"
import {forgotPassword,resetPassword} from "../controllers/forgotPassword.controller.js"

const router = express.Router();

router.post("/login", login);
router.post("/register", register);
router.post("/forgotPassword", forgotPassword);
router.post("/resetPassword/:token", resetPassword);
router.get("/github/callback", oAuthGithub);

export default router;
