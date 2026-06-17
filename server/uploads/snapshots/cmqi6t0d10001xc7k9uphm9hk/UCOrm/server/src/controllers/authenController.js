import {prisma} from "../config/prisma.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import {safeParse, z} from "zod";
import {authValid} from "../validates/authValidation.js";
import dotenv from "dotenv";

dotenv.config();

export const register = async(req, res) => {
    try {
        const result = authValid.safeParse(req.body);
        if(!result.success) return res.status(400).json({error: result.error.flatten().fieldErrors});
        const {name, email,password} = result.data;
        const existEmail = await prisma.users.findUnique({where: {email}});
        if(existEmail) return res.status(401).json({message: "Tài khoản đã tồn tại!"});
        const hashPass = await bcrypt.hash(password,10);
        const user = await prisma.users.create({data: {name, password: hashPass, email}});
        return res.status(201).json({message: "Đã tạo tài khoản thành công!", user: {name: user.name, email: user.email} });
    } catch (error) {
        console.log(error);
        return res.status(500).json({message : "Có lỗi server!"});
    }
}

export const login = async(req,res) => {
    try {
        const {email, password } = req.body;
        const user = await prisma.users.findUnique({where: {email}});
        if(!user) return res.status(401).json({message: "Tài khoản hoặc mật khẩu không đúng!"});
        const hashedPass = await bcrypt.compare(password, user.password);
        if(hashedPass === false) return res.status(401).json({message: "Tài khoản hoặc mật khẩu không đúng!"});
        const token = jwt.sign({userId : user.id, userEmail : user.email, userName : user.name}, process.env.JWT_SECRETS, {expiresIn: "1h"});
        return res.status(200).json({message: "Đăng nhập thành công!", token, name: user.name, email: user.email});
    } catch (error) {
        console.log(error);
        return res.status(500).json({message : "Có lỗi server!"});
    }
}