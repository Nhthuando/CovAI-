import {useEffect, useRef, useState} from 'react';
import {getSystemTestEvidence} from '../../services/coverage.service.js';

export default function SystemTestEvidence({snapshotId, scenarioId, title}) {
  const [url,setUrl]=useState(null);
  const [error,setError]=useState('');
  const [open,setOpen]=useState(false);
  const [requestKey,setRequestKey]=useState(0);
  const dialogRef=useRef(null);
  const triggerRef=useRef(null);
  useEffect(()=>{
    const controller=new AbortController();
    let objectUrl;
    getSystemTestEvidence(snapshotId,scenarioId,controller.signal).then(blob=>{
      if(controller.signal.aborted) return;
      objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);
    }).catch(err=>{if(err.name !== 'AbortError') setError(err.message);});
    return ()=>{controller.abort();if(objectUrl) URL.revokeObjectURL(objectUrl);};
  },[snapshotId,scenarioId,requestKey]);
  useEffect(()=>{
    if(!open) return;
    const dialog=dialogRef.current;
    const trigger=triggerRef.current;
    dialog?.showModal();
    return ()=>{if(dialog?.open) dialog.close();trigger?.focus();};
  },[open]);
  if(error) return <div role="status" style={{fontSize:11,color:'#8b949e'}}>Evidence unavailable <button onClick={event=>{event.stopPropagation();setError('');setRequestKey(value=>value+1);}}>Retry</button></div>;
  if(!url) return <div style={{fontSize:11,color:'#8b949e'}}>Loading evidence…</div>;
  return <>
    <button ref={triggerRef} type="button" aria-label={`View evidence: ${title}`} onClick={event=>{event.stopPropagation();setOpen(true);}} style={{display:'block',background:'transparent',border:'1px solid #30363d',borderRadius:6,padding:3,color:'#c9d1d9',cursor:'pointer',fontSize:10}}><img src={url} alt={`Screenshot: ${title}`} style={{width:100,height:56,objectFit:'cover',display:'block',borderRadius:3}}/><span>View screenshot</span></button>
    {open && <dialog ref={dialogRef} aria-label={`Evidence: ${title}`} onCancel={event=>{event.preventDefault();setOpen(false);}} onClick={event=>event.stopPropagation()} style={{position:'fixed',inset:0,margin:'auto',zIndex:1000,width:'min(1000px,90vw)',maxHeight:'90vh',overflow:'auto',background:'#161b22',border:'1px solid #30363d',borderRadius:10,color:'#f0f6fc',padding:16,boxShadow:'0 0 0 100vmax rgba(0,0,0,.75)'}}><button autoFocus onClick={()=>setOpen(false)} style={{float:'right',padding:'6px 10px',border:'1px solid #30363d',borderRadius:6,background:'#21262d',color:'#f0f6fc',cursor:'pointer'}}>Close</button><p>{title}</p><img src={url} alt={title} style={{maxWidth:'100%',display:'block'}}/></dialog>}
  </>;
}
