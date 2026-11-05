import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { projectSystemAssessment } from './systemReportProjection.service.js';
import { PDF_COLORS as c, pdfText, formatPdfDate, formatPdfCounter } from './systemTestPdfLayout.service.js';

export const renderSystemTestPdf = ({assessment,artifacts=[],images=[],generatedAt=new Date()}) => new Promise((resolve,reject)=>{
    const report=projectSystemAssessment(assessment,{artifacts}).presentation;
    const doc=new PDFDocument({size:'A4',margins:{top:58,bottom:58,left:44,right:44},bufferPages:true,info:{Title:'CovAI System Test Report',Author:'CovAI',Subject:`Assessment ${assessment.id}`}});
    const chunks=[];
    doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    try {
        doc.registerFont('Body',fileURLToPath(new URL('../assets/fonts/NotoSans-Regular.ttf',import.meta.url)));
        doc.registerFont('Bold',fileURLToPath(new URL('../assets/fonts/NotoSans-Bold.ttf',import.meta.url)));
        const width=doc.page.width-88;
        const ensure=height=>{if(doc.y+height>doc.page.height-64)doc.addPage();};
        const text=(value,{size=9,bold=false,color=c.ink,...options}={})=>{doc.font(bold?'Bold':'Body').fontSize(size).fillColor(color).text(pdfText(value),44,doc.y,{width,lineGap:3,...options});};
        const heading=(title,subtitle)=>{ensure(72);doc.moveDown(0.8);text(title,{size:14,bold:true});if(subtitle)text(subtitle,{size:8,color:c.muted});doc.moveDown(0.5);};
        const rule=()=>{ensure(12);doc.moveTo(44,doc.y).lineTo(44+width,doc.y).strokeColor(c.rule).lineWidth(0.5).stroke();doc.y+=12;};
        const bar=(label,value,color=c.accent)=>{
            ensure(48);text(label,{size:9,bold:true});const y=doc.y+5;
            doc.roundedRect(44,y,width,7,3).fill(c.paper);
            if(value?.total>0&&Number.isFinite(value.pct))doc.roundedRect(44,y,width*Math.max(0,Math.min(100,value.pct))/100,7,3).fill(color);
            doc.y=y+13;text(formatPdfCounter(value),{size:8,color:c.muted});doc.moveDown(0.4);
        };
        text('COVAI / SYSTEM TEST',{size:9,bold:true,color:c.accent});doc.moveDown(0.5);
        text('Execution report',{size:28,bold:true});doc.moveDown(0.5);
        text(`${String(report.identity.runner||'Unknown').toUpperCase()}  /  ${report.identity.executionMode==='full'?'Full Stack':'Frontend'}`,{size:10,color:c.muted});
        text(`Assessment: ${assessment.id}`,{size:8,color:c.muted});text(`Snapshot: ${assessment.snapshotId}`,{size:8,color:c.muted});
        text(`Test version: ${report.identity.suiteVersionId||'Not recorded'}`,{size:8,color:c.muted});
        text(`Assessment created: ${formatPdfDate(assessment.createdAt)}`,{size:8,color:c.muted});text(`Exported: ${formatPdfDate(generatedAt)}`,{size:8,color:c.muted});doc.moveDown();rule();
        const e=report.execution;
        text(`${e.passed} passed  /  ${e.selected} selected scenarios`,{size:19,bold:true});
        text(`${e.failed} failed  |  ${e.flaky} flaky  |  ${e.skipped} skipped  |  ${e.blocked} blocked  |  ${e.canceled} canceled`,{size:9,color:c.muted});
        ensure(38);const y=doc.y+12;let x=44;
        for(const status of ['passed','failed','flaky','skipped','blocked','canceled','notRun'])if(e[status]>0&&e.selected){const segment=width*e[status]/e.selected;doc.rect(x,y,segment,10).fill(c[status]);x+=segment;}
        doc.y=y+25;
        text(`Repeat evidence: ${report.stability.completedRuns}/${report.stability.requiredRuns} runs; ${report.stability.status.replaceAll('_',' ').toLowerCase()}`,{size:9});
        text(`Suite quality: ${report.qualityScore.status==='CALCULATED'?`${report.qualityScore.value}/100`:'Not calculated'}`,{size:9});
        if(report.qualityScore.status==='CALCULATED')text(`Score components: ${Object.entries(report.qualityScore.components||{}).map(([key,value])=>`${key}: ${Number(value).toFixed(1)}`).join(' / ')}`,{size:8,color:c.muted});
        if(report.qualityScore.status==='CALCULATED')text(`Score components: ${Object.entries(report.qualityScore.components||{}).map(([name,value])=>`${name} ${Number(value).toFixed(1)}`).join(' / ')}`,{size:8,color:c.muted});
        text('Observed repeat consistency is not a guarantee of future stability. Failed scenarios are not automatically confirmed product defects.',{size:8,color:c.muted});
        heading('Requirement verification');
        const req=report.requirements;
        if(req.status==='MEASURED')bar('Confirmed criteria verified',{covered:req.verified,total:req.total,pct:req.total?100*req.verified/req.total:null},c.passed);
        else text('Not measured. Confirm business criteria and review assertion mappings first.',{color:c.muted});
        heading('Source coverage','Execution hits measure exercised code, not business correctness.');
        for(const tier of ['frontend','backend']){
            const measurement=report.coverage[tier];ensure(measurement.counters ? 245 : 65);text(`${tier.toUpperCase()} / ${measurement.status}`,{bold:true,size:10});
            if(measurement.counters)for(const metric of ['lines','branches','functions','statements'])bar(metric[0].toUpperCase()+metric.slice(1),measurement.counters[metric],tier==='frontend'?c.accent:c.passed);
            else text('Not measured',{size:8,color:c.muted});
            if(measurement.reasonCodes?.length)text(measurement.reasonCodes.join(', '),{size:8,color:c.muted});
        }
        heading('Priority findings',`${report.gaps.length} recorded findings in this assessment`);
        if(!report.gaps.length)text('No findings recorded. Missing findings do not establish complete coverage.',{color:c.muted});
        for(const [index,gap] of report.gaps.entries()){
            ensure(45);text(`${index+1}. ${gap.kind||'Finding'}`,{bold:true,size:9});text(gap.description||gap.message,{size:9});
            if(gap.nextAction)text(gap.nextAction,{size:8,color:c.muted});if(gap.filePath)text(`${gap.filePath}${gap.line?':'+gap.line:''}`,{size:8,color:c.muted});doc.moveDown(0.5);
        }
        heading('Scenario outcomes and repeat evidence');
        for(const scenario of report.scenarios){
            ensure(100);rule();text(`${scenario.executionStatus.toUpperCase()} / ${scenario.title}`,{bold:true,size:11,color:c[scenario.executionStatus]||c.ink});
            text(scenario.filePath,{size:8,color:c.muted});text(`Review: ${scenario.reviewState}; assertion quality: ${scenario.qualityStatus}`,{size:8,color:c.muted});
            text(`Input: ${scenario.inputs.length?scenario.inputs.join('; '):'Not recorded'}`,{size:9});
            text(`Expected: ${scenario.expected.length?scenario.expected.join('; '):'Not recorded'}`,{size:9});
            for(const attempt of scenario.attempts){
                ensure(28);text(`Run ${attempt.runIndex}: ${attempt.status}${Number.isFinite(attempt.durationMs)?` / ${(attempt.durationMs/1000).toFixed(2)}s`:''}`,{bold:true,size:9});
                for(const error of attempt.errors){const raw=String(error);text(raw.slice(0,2000)+(raw.length>2000?' [Truncated; inspect original execution evidence.]':''),{size:8,color:c.failed});}
                if(attempt.apiCalls.length)text(`Captured API calls: ${attempt.apiCalls.map(call=>`${call.method} ${call.path} [${call.status}]`).join('; ')}`,{size:8,color:c.muted});
            }
            const image=images.find(item=>item.scenarioKey===scenario.scenarioKey);
            if(image){ensure(220);try{doc.image(image.bytes,44,doc.y,{fit:[width,200]});doc.y+=207;text(`Captured evidence / run ${image.runIndex||'unknown'}`,{size:8,color:c.muted});}catch{text('Evidence image unavailable or invalid.',{size:8,color:c.muted});}}
            else text(scenario.artifacts.some(item=>item.expiredAt) ? 'Screenshot: evidence expired.' : scenario.artifacts.some(item=>item.kind==='SCREENSHOT') ? 'Screenshot not embedded. Inspect the evidence manifest for availability.' : 'Screenshot: Not captured.',{size:8,color:c.muted});
        }
        if(req.criteria?.length)heading('Business criteria traceability');
        for(const criterion of req.criteria||[]){ensure(45);text(`${criterion.verified?'VERIFIED':'PENDING'} / ${criterion.id}`,{bold:true,size:9});text(criterion.expectedOutcome,{size:9});doc.moveDown(0.4);}
        heading('Evidence manifest',`${artifacts.length} retained artifact records; up to four selected screenshots are embedded.`);
        if(!artifacts.length)text('Not captured. No binary artifact manifest is available.',{color:c.muted});
        for(const artifact of artifacts){ensure(48);text(`${artifact.kind} / run ${artifact.runIndex||'unknown'} / ${artifact.expiredAt?'Expired':'Recorded'}`,{bold:true,size:8});text(`Artifact: ${artifact.id} / Scenario: ${artifact.scenarioKey||'Unassigned'}`,{size:7,color:c.muted});text(`SHA-256: ${artifact.sha256}`,{size:7,color:c.muted});doc.moveDown(0.4);}
        ensure(145);
        heading('Provenance and limitations');
        text(`Source SHA-256: ${report.identity.sourceHash}`,{size:8});text(`Test SHA-256: ${report.identity.testHash}`,{size:8});text(`Requirement revision: ${report.identity.requirementRevisionId||'Not recorded'}`,{size:8});
        for(const run of assessment.reportJson?.runs||[])text(`Run ${run.index}: ${run.testRunId||run.measurementId||'Legacy identity unavailable'}`,{size:8});
        for(const limitation of report.limitations)text(limitation,{size:8,color:c.muted});
        text('Screenshots and traces may contain application data. Artifact access requires project authorization and is subject to retention.',{size:8,color:c.muted});
        const pages=doc.bufferedPageRange();
        for(let index=0;index<pages.count;index++){
            doc.switchToPage(pages.start+index);doc.save();doc.rect(0,0,doc.page.width,4).fill(c.accent);
            const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;
            doc.font('Body').fontSize(7).fillColor(c.muted).text(`CovAI / System Test / ${assessment.id}`,44,24,{width,lineBreak:false});
            doc.text(`${index+1} / ${pages.count}`,44,doc.page.height-35,{width,align:'right',lineBreak:false});doc.page.margins.bottom=bottom;doc.restore();
        }
        doc.end();
    }catch(error){doc.destroy(error);reject(error);}
});
