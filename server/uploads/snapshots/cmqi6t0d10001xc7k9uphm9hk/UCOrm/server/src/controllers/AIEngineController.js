import { prisma } from "../config/prisma.js";
import { GoogleGenerativeAI } from "@google/generative-ai";


export const generateAIReply = async(req,res) => {
    try {
        const userId = req.user.id;
        if(!userId) return res.status(401).json({message: "Không thể xác thực user!"});
        const { reviewId }= req.params;
        const review = await prisma.reviews.findUnique({where: {id: reviewId}, include: {places: {select: {user_id: true}}} });
        if(!review) return res.status(404).json({message: "Review không tồn tại!"});
        if(review.places.user_id !== userId) return res.status(403).json({message: "User chưa tồn tại place chứa reviewId này!"});
        const existReply = await prisma.ai_replies.findMany({where: {review_id: reviewId}});
        if(existReply.length > 0) return res.status(200).json({message: "AI Generate thành công!", existReply});
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const prompt = `Bạn là quản lí chuyên nghiệp. Khách hàng để lại đánh giá sau:
                        Số sao: ${review.rating}/5
                        Nội dung: "${review.text}"
                        Hãy viết 3 câu trả lời bằng tiếng Việt theo định dạng JSON sau:
                        {
                        "standard": "câu trả lời chuyên nghiệp, lịch sự",
                        "friendly": "câu trả lời thân thiện, gần gũi",
                        "fix": "câu trả lời thừa nhận vấn đề và cam kết khắc phục"
                        }
                        Chỉ trả về JSON, không thêm bất kỳ text nào khác.`
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
        await prisma.ai_replies.createMany({data: [
                { review_id: reviewId, type: "STANDARD", content: parsed.standard },
                { review_id: reviewId, type: "FRIENDLY", content: parsed.friendly },
                { review_id: reviewId, type: "FIX",      content: parsed.fix },
                ]
            });
        const reply = await prisma.ai_replies.findMany({where: { review_id: reviewId }});
        return res.status(200).json({message: "AI Generate thành công!", reply });
    } catch (error) {
        console.log(error);
        return res.status(500).json({message: "Có lỗi servers!"});
    }
}

export const getAIReply = async(req,res) => {
    try {
        const { reviewId }= req.params;
        const reply = await prisma.ai_replies.findMany({where: {review_id: reviewId}});
        if(reply.length === 0) return res.status(404).json({message: "AI chưa generate reply !"});
        return res.status(200).json({message: "Lấy AI replies thành công!", reply});
    } catch (error) {
        console.log(error);
        return res.status(500).json({message: "Có lỗi servers!"});
    }
}

export const approveReview = async(req,res) =>{
    try {
        const userId = req.user.id;
        if(!userId) return res.status(401).json({message: "Không thể xác thực user!"});
        const {AIReplyId} = req.body;
        const { reviewId }= req.params;
        const review = await prisma.reviews.findUnique({where: {id: reviewId}, include: {places: {select: {user_id: true}}} });
        if(!review) return res.status(404).json({message: "Review không tồn tại!"});
        if(review.places.user_id !== userId) return res.status(403).json({message: "User chưa tồn tại place chứa reviewId này!"});
        if(review.status === "RESOLVED") return res.status(400).json({message: "Review đã được resolved!"});
        const AIReply = await prisma.ai_replies.findFirst({where: {id: AIReplyId, review_id: reviewId}});
        if(!AIReply) return res.status(400).json({message: "AIReplyId không thuộc review này "});
        await prisma.reviews.update({where: {id: reviewId}, data: {approved_reply_id: AIReplyId, status: "RESOLVED"}});
        return res.status(201).json({message:"Đã approve review!", reviewId: review.id, status: "RESOLVED", approved_reply_id: review.approved_reply_id});
    } catch (error) {
        console.log(error);
        return res.status(500).json({message: "Có lỗi server!"});
    }
}