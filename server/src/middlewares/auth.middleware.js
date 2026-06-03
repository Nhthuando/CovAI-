import jwt from "jsonwebtoken"

export const authMiddleware = (req,res,next) => {
    try {
        const bearerToken = req.header("authorization");
        if(!bearerToken) return res.status(401).json({message: "Không tìm thấy token!"});
        if(!bearerToken.startsWith("Bearer ")) return res.status(401).json({message: "Token không hợp lệ!"});
        const token = bearerToken.split(" ")[1];
        if(!token) return res.status(401).json({message: "Không tìm thấy token!"});
        const jwtsecret = process.env.JWT_SECRETS;
        if(!jwtsecret) return res.status(500).json({message: "Không tìm thấy JWT_SECRETS!"});
        const decode = jwt.verify(token,jwtsecret);
        const { userId: id, userName: name, userEmail: email } = decode;
        req.user = {id, name, email};
        next();
    } catch (error) {
        if (error?.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Token hết hạn!" });
        }
        return res.status(401).json({ message: "Token không hợp lệ!" });
    }
}