import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";

import authRoute from "./src/routes/auth.route.js";
import userRoute from "./src/routes/user.route.js";
import projectRoutes from "./src/routes/project.route.js";
import prisma from "./src/config/prisma.js";
import uploadRoute from "./src/routes/upload.route.js";
import jobRoute from "./src/routes/job.route.js";
import coverageRoute from "./src/routes/coverage.route.js";
import githubRoute from "./src/routes/github.route.js";

const app = express();
const PORT = process.env.PORT || 5000;

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

app.use(express.json());

app.use("/api/auth", authRoute);
app.use("/api/users", userRoute);
app.use("/api/projects", projectRoutes);
app.use("/api/upload", uploadRoute);
app.use("/api/job", jobRoute);
app.use("/api/coverage", coverageRoute);
app.use("/api/github", githubRoute);

app.get("/", (req, res) => {
  res.json({ message: "CovAI API is running" });
});

async function startServer() {
  try {
    await prisma.$connect();
    console.log("Database connected successfully.");

    app.listen(PORT, () => {
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
