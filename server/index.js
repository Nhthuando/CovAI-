import dotenv from "dotenv";
dotenv.config();

import express from "express";

import authRoute from "./src/routes/auth.route.js";
import userRoute from "./src/routes/user.route.js";
import projectRoutes from "./src/routes/project.route.js";
import prisma from "./src/config/prisma.js";


const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.use("/api/auth", authRoute);
app.use("/api/projects", projectRoutes);

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
