import { useCallback, useEffect, useState } from 'react';
import { systemEvidenceRequest } from '../services/systemTest.service.js';

export default function useSystemTestWorkspace({ snapshotId, runner, executionMode, refreshKey }) {
  const [selection, setSelection] = useState(null);
  const [data, setData] = useState({ key: null, assessment: null, history: [], error: '' });
  const key = `${snapshotId}:${runner}:${executionMode}`;
  const selectedId = selection?.key === key ? selection.id : null;
  useEffect(() => {
    let current = true;
    if (!snapshotId) return;
    const query = new URLSearchParams({ runner, executionMode, limit: '20' });
    systemEvidenceRequest(snapshotId, `assessments/history?${query}`).then(async history => {
      const id = selectedId || history.items.find(row => row.status === 'COMPLETED')?.id;
      const assessment = id ? await systemEvidenceRequest(snapshotId, `assessments/${id}`) : null;
      if (current) setData({ key, assessment, history: history.items, nextCursor:history.nextCursor, error: '' });
    }).catch(error => { if (current) setData({ key, assessment: null, history: [], error: error.response?.data?.message || error.message }); });
    return () => { current = false; };
  }, [snapshotId, runner, executionMode, refreshKey, selectedId, key]);
  const selectAssessment=useCallback(id=>setSelection({key,id}),[key]);
  const loadMore=async()=>{
    if(!data.nextCursor)return;
    try {
      const query=new URLSearchParams({runner,executionMode,limit:'20',cursor:data.nextCursor});
      const next=await systemEvidenceRequest(snapshotId,`assessments/history?${query}`);
      setData(current=>current.key===key?{...current,history:[...current.history,...next.items.filter(row=>!current.history.some(item=>item.id===row.id))],nextCursor:next.nextCursor}:current);
    }catch(error){setData(current=>current.key===key?{...current,error:error.response?.data?.message||error.message}:current);}
  };
  return { ...(data.key === key ? data : { assessment: null, history: [], error: '' }), selectAssessment, loadMore };
}
