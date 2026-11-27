import { systemSuiteError } from '../services/systemSuiteAvailability.service.js';
import { z } from 'zod';
import { parseRequest } from '../validators/systemAssessment.validator.js';
import { applySystemGenerationDraft, latestSystemGenerationDraft, listSystemTestPlans, startFillMissingSystemDraft } from '../services/systemGenerationProposal.service.js';
const applyRequest = z.object({expectedCandidateHash:z.string().regex(/^[a-f0-9]{64}$/),reviewed:z.literal(true),approveSharedSetup:z.boolean().default(false)}).strict();
export const latestGeneratedSystemDraft = async (req,res)=>{
    try{res.json({success:true,data:await latestSystemGenerationDraft({snapshotId:req.params.snapshotId,userId:req.user.id})});}
    catch(error){error=systemSuiteError(error);res.status(error.statusCode||500).json({success:false,message:error.statusCode?error.message:'Could not recover the generation draft'});}
};
export const getSystemTestPlansController = async (req, res) => {
    try {
        const data = await listSystemTestPlans({ snapshotId: req.params.snapshotId, userId: req.user.id });
        res.json({ success: true, data });
    } catch (error) {
        error = systemSuiteError(error);
        res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Could not load system test plans' });
    }
};
export const applyGeneratedSystemDraft = async (req,res) => {
    try {
        const data=await applySystemGenerationDraft({snapshotId:req.params.snapshotId,draftId:req.params.draftId,userId:req.user.id,input:parseRequest(applyRequest,req.body)});
        res.json({success:true,data});
    }catch(error){error=systemSuiteError(error);res.status(error.statusCode||500).json({success:false,message:error.statusCode?error.message:'Could not apply generated tests'});}
};

export const fillMissingGeneratedSystemDraft = async (req, res) => {
    try {
        const data = await startFillMissingSystemDraft({
            snapshotId: req.params.snapshotId,
            draftId: req.params.draftId,
            userId: req.user.id,
        });
        res.status(202).json({ success: true, data });
    } catch (error) {
        error = systemSuiteError(error);
        res.status(error.statusCode || 500).json({
            success: false,
            code: error.code,
            message: error.statusCode ? error.message : 'Could not generate missing tests',
            ...(error.code === 'GENERATION_IN_PROGRESS' && { data: error.details.task }),
        });
    }
};
