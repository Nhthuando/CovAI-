import { createRoot } from 'react-dom/client';
import SystemTestImprovementReview from '../src/components/dashboard/system/SystemTestImprovementReview.jsx';
import '../src/index.css';

const query = new URLSearchParams(location.search);
const setupFailed = query.has('setup') || query.has('environment');
const applied = query.has('partial') || query.has('reached');
const finished = query.has('finished') || applied || setupFailed;
const now = Date.now();
const proposal = {
  id:'fixture',state:applied?'APPLIED':finished?'FAILED_VERIFICATION':'VERIFYING',jobStatus:applied?'SUCCESS':finished?'FAILED':'RUNNING',jobProgress:40,
  jobStage:'Round 1/8: verifying new tests',
  timing:{startedAt:new Date(now-(finished?1213000:60000)).toISOString(),finishedAt:finished?new Date(now).toISOString():null,sampledAt:new Date(now).toISOString(),remaining:finished?null:{minMs:125000,maxMs:245000}},
  verificationJson:{goal:{target:95,milestone:90,maxRounds:8,lowestPct:query.has('reached')?96:query.has('partial')?90:48.1,reached:query.has('reached'),milestoneReached:applied,acceptedRounds:applied?2:0,stopReason:query.has('reached')?'TARGET_REACHED':applied?'REQUEST_LIMIT':finished?'TIME_LIMIT':null},aiUsage:{requests:4,maxRequests:12,reportedRequests:4,totalTokens:88246},error:finished?{code:'SYSTEM_OPERATION_TIMEOUT',message:'The improvement reached its 20-minute time limit. No unverified tests were saved.'}:null},
};
if (setupFailed) {
  proposal.timing.startedAt=new Date(now-113000).toISOString();
  proposal.verificationJson.goal={target:95,lowestPct:null,stopReason:'TIME_LIMIT'};
  proposal.verificationJson.aiUsage={requests:0,maxRequests:12,reportedRequests:0,totalTokens:0};
  proposal.verificationJson.error={code:'SYSTEM_RUNTIME_START_FAILED',message:'Full system setup failed: Disposable mysql did not become ready'};
  if(query.has('environment'))proposal.verificationJson.error={code:'SYSTEM_TEST_ENVIRONMENT_REQUIRED',message:'Set STRIPE_SECRET_KEY in server/.env.test to start the backend.'};
}
document.documentElement.dataset.theme = 'dark';
createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-6xl p-4 sm:p-8"><SystemTestImprovementReview proposal={proposal} onRetry={()=>{}} onApplied={()=>{}} /></main>);
