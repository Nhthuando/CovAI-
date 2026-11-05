import prisma from '../config/prisma.js';
import { systemSetupPreflight, applySystemSetup, setupApplyRequest } from '../services/systemSetupPreflight.service.js';
import { parseRequest } from '../validators/systemAssessment.validator.js';

export const createSystemSetupControllers = ({db=prisma,dependencies={}}={}) => {
    const handler = action => async (req,res) => {
        if(!req.user?.id)return res.status(401).json({success:false,message:'Authentication required'});
        try {res.json({success:true,data:await action(req)});}
        catch(error) {res.status(error.statusCode||500).json({success:false,code:error.code||'SYSTEM_SETUP_ERROR',message:error.statusCode?error.message:'Could not inspect project setup. Check the server connection and try again.'});}
    };
    const args=req=>({snapshotId:req.params.snapshotId,userId:req.user.id,db,dependencies});
    return {
        inspect:handler(req=>systemSetupPreflight(args(req))),
        apply:handler(req=>applySystemSetup({...args(req),input:parseRequest(setupApplyRequest,req.body)})),
    };
};
