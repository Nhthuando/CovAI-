import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { normalizeAuthProvider } from "../../../shared/versionControlMode.js";

dotenv.config();

export const authMiddleware = (req, res, next) => {
    try {
        const tokenQuery = req.query.token ? `Bearer ${req.query.token}` : null;
        const bearerToken = req.header("authorization") || req.header("Authorization") || tokenQuery;
        if (!bearerToken) {
            return res.status(401).json({ message: "Token not found!" });
        }

        const match = bearerToken.match(/^Bearer\s+(.+)$/i);
        if (!match) {
            return res.status(401).json({ message: "Invalid token!" });
        }

        const token = match[1];
        if (!token) {
            return res.status(401).json({ message: "Token not found!" });
        }

        const jwtsecret = process.env.JWT_SECRET;
        if (!jwtsecret) {
            return res.status(500).json({ message: "JWT_SECRET not found!" });
        }

        const decode = jwt.verify(token, jwtsecret);
        const { userId: id, userName: name, userEmail: email } = decode;
        const authProvider = normalizeAuthProvider(decode.authProvider);

        req.user = { id, name, email, authProvider };
        return next();
    } catch (error) {
        console.error("[authMiddleware]", error?.message || error);

        if (error?.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Token expired! Please login again." });
        }

        return res.status(401).json({
            message: "Invalid token!",
        });
    }
};