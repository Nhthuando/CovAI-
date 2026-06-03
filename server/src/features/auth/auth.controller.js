import prisma from "../../config/prisma.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import {authValid,loginValid} from "../auth/auth.valdation.js";


export const register = async (req,res) => {
    try {
        const result = authValid.safeParse(req.body);
        if(!result.success) return res.status(400).json({error: result.error.flatten().fieldErrors});
        const {name, email,password} = result.data;
        const existEmail = await prisma.user.findUnique({where: {email: email}});
        if(existEmail) return res.status(400).json({message: "Tài khoản đã tồn tại!"});
        const hashedPass = await bcrypt.hash(password,10);
        const user = await prisma.user.create({data: {email, passwordHash: hashedPass, name}});
        return res.status(201).json({message: "Đăng ký thành công!", userName: name, userEmail: email});
    } catch (error) {
        console.log(error);
        return res.status(500).json({message: "Có lỗi server!"})
    }
}

export const login = async (req,res) => {
    try {
        const result = loginValid.safeParse(req.body);
        if (!result.success) return res.status(400).json({ error: result.error.flatten().fieldErrors });
        const { email, password } = result.data;
        const user = await prisma.user.findUnique({where: {email}});
        if(!user) return res.status(401).json({message: "Email hoặc mật khẩu không chính xác!"});
        const checkPass = await bcrypt.compare(password, user.passwordHash);
        if(!checkPass) return res.status(401).json({message: "Email hoặc mật khẩu không chính xác!"});
        const token = jwt.sign({userId : user.id, userEmail : user.email, userName : user.name}, process.env.JWT_SECRET, {expiresIn: "1h"});
        return res.status(200).json({message: "Đăng nhập thành công!", token, name: user.name, email: user.email});
    } catch (error) {
        console.log(error);
        return res.status(500).json({message: "Có lỗi server!"})
    }
}