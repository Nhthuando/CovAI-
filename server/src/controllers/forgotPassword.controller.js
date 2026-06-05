import {sendEmail} from "../utils/sendEmail.js";
import prisma from "../config/prisma.js"; 
import crypto from "crypto";
import {resetPasswordEmailHtml} from "../utils/emailTemplate.js";
import bcrypt from "bcryptjs";
import {resetPasswordValid} from "../validators/auth.validation.js";

export const forgotPassword  = async (req,res) => {
    try {
        const {email} = req.body;
        const user = await prisma.user.findUnique({where: {email}});
        if(!user) {
            return res.status(200).json({message: "Đã gửi link reset mật khẩu, vui lòng kiểm tra email!"});
        } 
        if (user.passwordResetExpires && user.passwordResetExpires > new Date()) {return res.status(429).json({ message: 'Vui lòng chờ hết hạn link cũ trước khi yêu cầu lại.' });}
        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        const tokenExpires = new Date(Date.now() + 5 * 60 * 1000);
        await prisma.user.update({where: {email}, data: {passwordResetToken: hashedToken, passwordResetExpires: tokenExpires}});
        const resetUrl = `http://localhost:5173/reset-password?token=${resetToken}`;
        try {
            await sendEmail({email: email, subject: "ĐẶT LẠI MẬT KHẨU | CovAI Service", html: resetPasswordEmailHtml(user.name,resetUrl)})
            return res.status(200).json({message: "Đã gửi link reset mật khẩu, vui lòng kiểm tra email!"});
        } catch (error) {
            await prisma.user.update({where: {email}, data: {passwordResetToken: null, passwordResetExpires: null}});
            return res.status(500).json({ message: 'Lỗi gửi email, vui lòng thử lại.' });
        }
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Có lỗi server!" });
    }
}

export const resetPassword = async(req,res) => {
    try {
        const {token} = req.params;
        const result = resetPasswordValid.safeParse(req.body);
        if(!result.success) return res.status(400).json({error: result.error.flatten().fieldErrors});
        const {newPassword} = result.data;        
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const validUser = await prisma.user.findFirst({where: {passwordResetToken: hashedToken, passwordResetExpires: {gt: new Date()}}})
        if(!validUser) return res.status(400).json({message: 'Token không hợp lệ hoặc đã hết hạn'})
        const hashedPass = await bcrypt.hash(newPassword,10);
        await prisma.user.update({where: {id: validUser.id}, data: {passwordHash: hashedPass, passwordResetExpires: null, passwordResetToken: null}});
        return res.status(200).json({ message: 'Đặt lại mật khẩu thành công!' });
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Có lỗi server!" });
    }
}