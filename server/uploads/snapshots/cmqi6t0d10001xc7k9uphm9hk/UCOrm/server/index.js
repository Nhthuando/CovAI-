import express from "express";
import authRouter from "./src/routes/authenRoutes.js";
import placeRouter from "./src/routes/placeRoutes.js";
import AIRouter from "./src/routes/AIRoutes.js";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();


const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
    "https://ucorm.vercel.app",
    "http://localhost:5173"
];

app.use(
    cors({
        origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
        },
        credentials: true,
    })
);

app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/places", placeRouter);
app.use("/api/reviews", AIRouter);



app.listen(PORT,  () => {
    console.log("-----------------------------------------------");
    console.log("UCORM server đang được chạy dưới port: " + PORT);
    console.log("-----------------------------------------------");
})

