import { prisma } from "../config/prisma.js";
import dotenv from "dotenv";

dotenv.config();

export const postPlace = async(req,res) => {
    try {
        const userId = req.user.id;
        if(!userId) return res.status(401).json({message: "Không thể xác thực user!"});
        const {ggPlaceId} = req.body;
        if (!ggPlaceId) return res.status(400).json({ message: "ggPlaceId là bắt buộc!" });
        const checkPlace = await prisma.places.findFirst({where: {user_id: userId, google_place_id: ggPlaceId }});
        if(checkPlace) return res.status(200).json  ({message: "Place đã tồn tại", place: checkPlace });
        const ggResponse = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${ggPlaceId}&fields=name&key=${process.env.GOOGLE_API_KEY}`);
        const ggData = await ggResponse.json();
        if (ggData.status !== "OK") return res.status(400).json({ message: "Place ID không hợp lệ hoặc không tìm thấy!" });
        const place = await prisma.places.create({data: {google_place_id: ggPlaceId,user_id: userId, name: ggData.result.name}});
        return res.status(201).json({message: "Thêm thành công!", place })
    } catch (error) {
        console.log(error);
        return res.status(500).json({message: "Có lỗi server!"});
    }
}

export const getPlace = async(req,res) => {
    try {
        const userId = req.user.id;
        if(!userId) return res.status(401).json({message: "Không thể xác thực user!"});
        const place = await prisma.places.findMany({where: {user_id: userId}});
        return res.status(200).json({message: "Lấy place thành công!", place});
    } catch (error) {
        console.log(error);
        return res.status(500).json({message: "Có lỗi server!"});
    }
}

export const getReview = async(req,res) => {
    try {
        const userId = req.user.id;
        if(!userId) return res.status(401).json({message: "Không thể xác thực users!"});
        const {placeId} = req.params;
        if(!placeId) return res.status(400).json({message: "Không lấy được placeId!"});
        const place = await prisma.places.findFirst({where: {id: placeId}, select : {user_id: true, google_place_id: true}});
        if(!place) return res.status(404).json({message: "Place không tồn tại!"});
        if(userId !== place.user_id) return res.status(403).json({message: "User chưa tồn tại place id này!"});
        const reviewsResponse = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.google_place_id}&fields=reviews&key=${process.env.GOOGLE_API_KEY}`);
        const reviewsData = await reviewsResponse.json();
        for(const i of reviewsData.result.reviews){
            const googleId = `${place.google_place_id}_${i.time}_${i.author_name}`;
            const review = await prisma.reviews.findFirst({where: {google_id: googleId, place_id: placeId}})
            if(!review) await prisma.reviews.create({data: {google_id: googleId,author_name: i.author_name, rating: i.rating, text: i.text,place_id: placeId }})
        }
        const savedReviews = await prisma.reviews.findMany({where: { place_id: placeId }});
        return res.status(201).json({message: "Lấy reviews thành công!", savedReviews});
    } catch (error) {
        console.log(error);
        return res.status(500).json({message:"Có lỗi server!"});
    }
}

export const getReviewsFromPlace = async(req,res) => {
    try {
        const userId = req.user.id;
        if(!userId) return res.status(401).json({message: "Không thể xác thực users!"});
        const {placeId} = req.params;
        if(!placeId) return res.status(400).json({message: "Không lấy được placeId!"});
        const place = await prisma.places.findFirst({where: {id: placeId}, select : {user_id: true, google_place_id: true}});
        if(!place) return res.status(404).json({message: "Place không tồn tại!"});
        if(userId !== place.user_id) return res.status(403).json({message: "User chưa tồn tại place id này!"});
        const reviews = await prisma.reviews.findMany({where: {place_id: placeId}});
        if(reviews.length === 0) return res.status(404).json({message: "Place chưa tồn tại review nào!"});
        return res.status(200).json({message: "Lấy review thành công!", reviews});
    } catch (error) {
        console.log(error);
        return res.status(500).json({message: "Có lỗi server"})
    }
}
