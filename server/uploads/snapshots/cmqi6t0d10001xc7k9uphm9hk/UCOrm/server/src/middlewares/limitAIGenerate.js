import rateLimit from "express-rate-limit";

export const generateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5, 
    message: {
        message: "Quá nhiều request, vui lòng thử lại sau 1 phút!"
    },
    standardHeaders: true,
    legacyHeaders: false,
});