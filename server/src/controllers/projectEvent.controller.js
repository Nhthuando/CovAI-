import { listProjectEvents } from '../services/projectEvent.service.js';

export const getProjectEvents = async (req,res) => {
    try {
        const after = Number(req.query.after || 0);
        const limit = Number(req.query.limit || 100);
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({success:false,code:'INVALID_EVENT_CURSOR',message:'Invalid event cursor or limit'});
        }
        const data = await listProjectEvents({projectId:req.params.id,userId:req.user.id,
            after,limit});
        return res.json({success:true,data});
    } catch(error) {
        return res.status(error.statusCode || 500).json({success:false,code:error.code,message:error.message});
    }
};
