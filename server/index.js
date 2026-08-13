import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import authRoute from "./src/routes/auth.route.js";
import refreshRoute from "./src/routes/refresh.route.js";
import userRoute from "./src/routes/user.route.js";
import cookieParser from "cookie-parser";
import projectRoutes from "./src/routes/project.route.js";
import prisma from "./src/config/prisma.js";
import uploadRoute from "./src/routes/upload.route.js";
import jobRoute from "./src/routes/job.route.js";
import coverageRoute from "./src/routes/coverage.route.js";
import githubRoute from "./src/routes/github.route.js";
import cyclomaticRoute from "./src/routes/cyclomatic.route.js";
import aiSuggestionRoute from "./src/routes/aiSuggestion.route.js";
import aiTestRoute from "./src/routes/aiTest.route.js";
import fileRoutes from "./src/routes/file.routes.js";
import notificationRoute from "./src/routes/notification.route.js";
import {
  eventDispatcher,
  NOTIFICATION_EVENT,
} from "./src/utils/eventDispatcher.js";
import analyticsRoute from "./src/routes/analytics.route.js";
import codeHygieneRoute from "./src/routes/codeHygiene.route.js";
import fileManagerRoute from "./src/routes/fileManager.route.js";
import { globalLimiter } from "./src/middlewares/rateLimit.middleware.js";
import path from "path";
import { fileURLToPath } from "url";
import "./src/services/queue.service.js";
import "./src/services/codeHygieneJob.service.js";

const app = express();
const PORT = process.env.PORT || 5000;
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [
      process.env.CLIENT_URL || "http://localhost:5173",
      "http://localhost:5174",
    ],
    credentials: true,
  },
});

// CORS — allow Vite dev server and production domain

app.use(
  cors({
    origin: [
      process.env.CLIENT_URL || "http://localhost:5173",
      "http://localhost:5174",
    ],
    credentials: true,
  }),
);

app.use(cookieParser());
app.use(express.json());

// Global rate limiter
app.use(globalLimiter);

app.use("/api/auth", authRoute);
app.use("/api/refresh", refreshRoute);
app.use("/api/users", userRoute);
app.use("/api/projects", projectRoutes);
app.use("/api/upload", uploadRoute);
app.use("/api/job", jobRoute);
app.use("/api/coverage", coverageRoute);
app.use("/api/github", githubRoute);
app.use("/api/cyclomatic", cyclomaticRoute);
app.use("/api/ai-suggestions", aiSuggestionRoute);
app.use("/api/ai-tests", aiTestRoute);
app.use("/api/files", fileRoutes);
app.use("/api/notifications", notificationRoute);
app.use("/api/analytics", analyticsRoute);
app.use("/api/code-hygiene", codeHygieneRoute);
app.use("/api/file-manager", fileManagerRoute);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../client/dist")));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`[Socket.IO] User connected: ${socket.id}`);

  socket.on("subscribe_notifications", (userId) => {
    socket.join(`user:${userId}`);
    console.log(`[Socket.IO] User ${userId} subscribed to notifications`);
  });

  socket.on("disconnect", () => {
    console.log(`[Socket.IO] User disconnected: ${socket.id}`);
  });
});

// Make io available globally for services
global.io = io;

async function startServer() {
  try {
    await prisma.$connect();
    console.log("Database connected successfully.");

    httpServer.listen(PORT, () => {
      console.log("-----------------------------------------------");
      console.log("CovAI server đang được chạy dưới port: " + PORT);
      console.log("-----------------------------------------------");
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
}

startServer();
