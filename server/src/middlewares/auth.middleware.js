import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

export const authMiddleware = (req, res, next) => {
    try {
        const bearerToken = req.header("authorization") || req.header("Authorization");
        if (!bearerToken) {
            return res.status(401).json({ message: "Không tìm thấy token!" });
        }

        const match = bearerToken.match(/^Bearer\s+(.+)$/i);
        if (!match) {
            return res.status(401).json({ message: "Token không hợp lệ!" });
        }

        const token = match[1];
        if (!token) {
            return res.status(401).json({ message: "Không tìm thấy token!" });
        }

        const jwtsecret = process.env.JWT_SECRET;
        if (!jwtsecret) {
            return res.status(500).json({ message: "Không tìm thấy JWT_SECRET!" });
        }

        const decode = jwt.verify(token, jwtsecret);
        const { userId: id, userName: name, userEmail: email } = decode;

        req.user = { id, name, email };
        return next();
    } catch (error) {
        console.error("[authMiddleware]", error?.message || error);

        if (error?.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Token hết hạn! Vui lòng đăng nhập lại." });
        }

        return res.status(401).json({
            message: "Token không hợp lệ!",
            error: error?.message || "Unknown auth error",
        });
    }
};