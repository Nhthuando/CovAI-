import express from "express";
import dotenv from "dotenv";
import authRoute from "./src/features/auth/auth.route.js";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.use("/api/auth", authRoute);

app.listen(PORT,  () => {
    console.log("-----------------------------------------------");
    console.log("CovAI server đang được chạy dưới port: " + PORT);
    console.log("-----------------------------------------------");
})
