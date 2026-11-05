import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {sprints} from './cases.mjs';
const require=createRequire('C:/Users/thuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const dir=path.dirname(fileURLToPath(import.meta.url));
const sources=JSON.parse(await fs.readFile(path.join(dir,'sources.json'),'utf8'));
const blue='#B4C6E7', green='#92D050', red='#FF0000', totalGreen='#33A65C';
const font={name:'Times New Roman',size:13,color:'#000000'};
const statuses=['Not Run','Pass','Fail','Blocked'];
const col=n=>String.fromCharCode(65+n);
const revisionDate=new Date('2026-11-03T00:00:00Z');
const summary=[];
const put=(s,a,v)=>s.getRange(a).values=[[v]];
const formula=(s,a,v)=>s.getRange(a).formulas=[[v]];
const numbered=text=>text.split(/(?<=\.)\s+(?=[A-Z](?:[a-z]|[A-Z]))/).map((x,i)=>`${i+1}. ${x}`).join('\n');
function style(s,range){const r=s.getRange(range);r.format.font=font;r.format.verticalAlignment='top';r.format.wrapText=true;}
function head(s,range){const r=s.getRange(range);r.format.fill=blue;r.format.font={...font,bold:true};r.format.verticalAlignment='center';r.format.horizontalAlignment='center';}
function rowFit(s,row,values,widths,min=72){
 let lines=1;
 values.forEach((v,i)=>{const chars=Math.max(8,Math.floor((widths[i]-12)/8.1));lines=Math.max(lines,String(v??'').split('\n').reduce((n,l)=>n+Math.max(1,Math.ceil(l.length/chars)),0));});
 s.getRange(`A${row}:${col(widths.length-1)}${row}`).format.rowHeight=Math.max(min,lines*16+12);
}
function statusRules(s,column,last){
 const r=s.getRange(`${column}12:${column}${last}`);
 r.dataValidation={rule:{type:'list',values:statuses}};
 for(const [value,fill,color] of [['Pass',green,'#000000'],['Fail','#FFC7CE','#9C0006'],['Blocked','#FFEB9C','#9C6500']])
  r.conditionalFormats.add('cellIs',{operator:'equal',formula:`"${value}"`,format:{fill,font:{color}}});
}
function drawModule(wb,sp,m){
 const s=wb.worksheets.add(m.name);const auth=sp.number===1&&m.code==='AUTH';const last=11+m.cases.length;
 const widths=auth?[245,220,300,360,460,330,460,300,110]:[245,300,360,460,330,460,300,110];
 const end=col(widths.length-1);const status=end;
 style(s,`A1:${end}${last}`);s.showGridLines=true;
 widths.forEach((w,i)=>s.getRange(`${col(i)}1:${col(i)}${last}`).format.columnWidthPx=w);
 s.getRange(`A1:${end}9`).format.rowHeight=23;
 const labels=['Project name','Module name','Created by','Date created','Rated by','Evaluation date','Pass','Fail','Total'];
 labels.forEach((v,i)=>put(s,`A${i+1}`,v));
 s.getRange('A1:A6').format.fill=blue;s.getRange('B1:B6').format.fill=blue;s.getRange('A1:A6').format.font={...font,bold:true};
 put(s,'B1','COVAI - C1SE.30');put(s,'B2',m.name);put(s,'B3',`C1SE.30 (QA owner: ${m.owner})`);
 put(s,'B4',revisionDate);s.getRange('B4').setNumberFormat('dd/mm/yyyy');
 s.getRange('B2:B3').format.rowHeight=36;
 formula(s,'B7',`=COUNTIF(${status}12:${status}${last},"Pass")`);
 formula(s,'B8',`=COUNTIF(${status}12:${status}${last},"Fail")`);
 formula(s,'B9',`=COUNTA(A12:A${last})`);
 s.getRange('A7').format.fill=green;s.getRange('A8').format.fill=red;s.getRange('A9').format.fill=totalGreen;
 s.getRange('B7:B9').format.horizontalAlignment='center';
 s.getRange('A1:B9').format.borders={preset:'all',style:'thin',color:'#707070'};
 s.getRange('A10').format.rowHeight=10;
 const headers=auth?['Test case ID','Function/Display','Representation','Prerequisites','Testing steps','Test data','Expected results','Actual result','Status']:['Test case ID','Representation','Prerequisites','Testing steps','Test data','Expected results','Actual results','Status'];
 s.getRange(`A11:${end}11`).values=[headers];head(s,`A11:${end}11`);s.getRange(`A11:${end}11`).format.rowHeight=30;
 const rows=m.cases.map((c,i)=>{const id=`TC_COV_S${sp.number}_${m.code}_${String(i+1).padStart(3,'0')}`;return auth?[id,'Authentication',c[0],c[1],numbered(c[2]),c[3],c[4],null,'Not Run']:[id,c[0],c[1],numbered(c[2]),c[3],c[4],null,'Not Run'];});
 s.getRange(`A12:${end}${last}`).values=rows;
 s.getRange(`A11:${end}${last}`).format.borders={preset:'all',style:'thin',color:'#808080'};
 rows.forEach((r,i)=>rowFit(s,i+12,r,widths));
 s.getRange(`${status}12:${status}${last}`).format.verticalAlignment='center';
 statusRules(s,status,last);s.freezePanes.freezeRows(11);s.freezePanes.freezeColumns(1);
 return {sheet:s,rows,last,status,ids:rows.map(r=>r[0])};
}
function drawReport(wb,sp,modules){
 const s=wb.worksheets.add(`Sprint ${sp.number} Test Report`);const count=modules.length;const last=7+count;const total=last+1;
 const plan=sources[2].sheets.find(x=>x.name===`Sprint ${sp.number}`);
 const taskLimit=sp.number===1?53:43;
 const tasks=plan.rows.filter(r=>Object.keys(r).some(k=>k.startsWith('B')&&Number(k.slice(1))>=18&&Number(k.slice(1))<=taskLimit)).map(r=>{
  const row=Number(Object.keys(r).find(k=>k.startsWith('B')).slice(1));
  return {number:Number(r[`B${row}`]),name:r[`C${row}`],owner:r[`D${row}`]};
 });
 const noteStart=Math.max(26,total+3);const traceHeader=noteStart+sp.notes.length*3+3;const sourceHeader=traceHeader+tasks.length+3;const end=sourceHeader+modules.length*2+1;
 style(s,`A1:M${end}`);s.showGridLines=true;
 const widths=[75,365,90,95,95,115,145,125,125,125,125,105,105];
 widths.forEach((w,i)=>s.getRange(`${col(i)}1:${col(i)}${end}`).format.columnWidthPx=w);
 s.getRange(`A1:M${end}`).format.rowHeight=24;
 for(const row of [2,3,4,5,6]){s.mergeCells(`A${row}:B${row}`);s.mergeCells(`C${row}:F${row}`);}
 put(s,'A2','Project name');put(s,'C2','COVAI - C1SE.30');put(s,'G2','Test scope');s.mergeCells('H2:M2');put(s,'H2',`Sprint ${sp.number}`);
 put(s,'A3','Experimental design by');put(s,'C3','Team C1SE.30');put(s,'G3','Pass / plan');formula(s,'H3',`=IF(C${total}=0,0,D${total}/C${total})`);s.getRange('H3').setNumberFormat('0.0%');
 put(s,'A4','Reviewer / Approver');put(s,'G4','Version');put(s,'H4','1.0');
 put(s,'A5','Sprint start / end');put(s,'C5',sp.start);s.getRange('C5').setNumberFormat('dd/mm/yyyy');s.mergeCells('H5:I5');put(s,'H5',sp.end);s.getRange('H5').setNumberFormat('dd/mm/yyyy');
 put(s,'A6','Revision date');put(s,'C6',revisionDate);s.getRange('C6').setNumberFormat('dd/mm/yyyy');put(s,'G6','Execution');s.mergeCells('H6:M6');put(s,'H6','Record results after running each case.');
 s.getRange('A2:F6').format.borders={preset:'all',style:'thin',color:'#707070'};s.getRange('A2:B6').format.fill=blue;s.getRange('A2:B6').format.font={...font,bold:true};
 s.getRange('A7:F7').values=[['Number','Module name','Plan','Passing','Failure','Remaining']];head(s,'A7:F7');s.getRange('A7:M7').format.rowHeight=34;
 modules.forEach((m,i)=>{const row=8+i;put(s,`A${row}`,i+1);put(s,`B${row}`,m.name);const sheet=`'${m.name.replaceAll("'","''")}'`;
  formula(s,`C${row}`,`=${sheet}!B9`);formula(s,`D${row}`,`=${sheet}!B7`);formula(s,`E${row}`,`=${sheet}!B8`);formula(s,`F${row}`,`=C${row}-D${row}-E${row}`);
  s.getRange(`A${row}:F${row}`).format.rowHeight=38;
 });
 s.mergeCells(`A${total}:B${total}`);put(s,`A${total}`,'Total');for(const c of ['C','D','E','F'])formula(s,`${c}${total}`,`=SUM(${c}8:${c}${last})`);
 head(s,`A${total}:F${total}`);s.getRange(`A7:F${total}`).format.borders={preset:'all',style:'thin',color:'#707070'};
 s.getRange('G7:H12').values=[['Execution status','Cases'],['Planned',null],['Pass',null],['Fail',null],['Not Run',null],['Blocked',null]];head(s,'G7:H7');
 formula(s,'H8',`=C${total}`);formula(s,'H9',`=D${total}`);formula(s,'H10',`=E${total}`);
 for(const [cell,state] of [['H11','Not Run'],['H12','Blocked']])formula(s,cell,'='+modules.map(m=>`COUNTIF('${m.name}'!${m.status}12:${m.status}${m.last},"${state}")`).join('+'));
 s.getRange('G7:H12').format.borders={preset:'all',style:'thin',color:'#707070'};
 const chart=s.charts.add('pie',s.getRange('G9:H12'));chart.title=`Test Report Sprint ${sp.number}`;chart.titleTextStyle.typeface='Times New Roman';chart.titleTextStyle.fontSize=16;chart.legend={position:'bottom',textStyle:{typeface:'Times New Roman',fontSize:12}};chart.setPosition('I9','M22');
 s.mergeCells('G24:M24');put(s,'G24','Remaining = Not Run + Blocked. Pass / plan uses all planned cases.');s.getRange('G24:M24').format.rowHeight=36;
 const statusesRow=noteStart-1;s.mergeCells(`A${statusesRow}:M${statusesRow}`);head(s,`A${statusesRow}:M${statusesRow}`);put(s,`A${statusesRow}`,'Scope and execution notes');
 sp.notes.forEach((v,i)=>{const row=noteStart+i*3;s.mergeCells(`A${row}:M${row+1}`);put(s,`A${row}`,v);s.getRange(`A${row}:M${row+1}`).format.wrapText=true;});
 s.mergeCells(`A${traceHeader}:M${traceHeader}`);head(s,`A${traceHeader}:M${traceHeader}`);put(s,`A${traceHeader}`,'Sprint task traceability (task numbers follow the sprint workbook, not row order)');
 const th=traceHeader+1;s.mergeCells(`B${th}:E${th}`);s.mergeCells(`G${th}:H${th}`);s.mergeCells(`I${th}:M${th}`);
 put(s,`A${th}`,'Task');put(s,`B${th}`,'Task name');put(s,`F${th}`,'Sprint owner');put(s,`G${th}`,'Test modules');put(s,`I${th}`,'Test case IDs');head(s,`A${th}:M${th}`);
 tasks.sort((a,b)=>a.number-b.number).forEach((t,i)=>{const row=th+1+i;const mapped=modules.filter(m=>m.tasks.includes(t.number));if(!mapped.length)throw Error(`Unmapped S${sp.number} task ${t.number}`);
  s.mergeCells(`B${row}:E${row}`);s.mergeCells(`G${row}:H${row}`);s.mergeCells(`I${row}:M${row}`);
  put(s,`A${row}`,t.number);put(s,`B${row}`,t.name);put(s,`F${row}`,t.owner);put(s,`G${row}`,mapped.map(m=>m.name).join('\n'));
  put(s,`I${row}`,mapped.map(m=>`${m.ids[0]} to ${m.ids.at(-1)}`).join('\n'));
  s.getRange(`A${row}:M${row}`).format.rowHeight=Math.max(48,mapped.length*34);
 });
 s.mergeCells(`A${sourceHeader}:M${sourceHeader}`);head(s,`A${sourceHeader}:M${sourceHeader}`);put(s,`A${sourceHeader}`,'Source references');
 modules.forEach((m,i)=>{const row=sourceHeader+1+i*2;s.mergeCells(`A${row}:B${row+1}`);s.mergeCells(`C${row}:M${row+1}`);put(s,`A${row}`,m.name);put(s,`C${row}`,m.source);});
 return {sheet:s,total,taskCount:tasks.length,end};
}
// Correct a reference discovered during source review. Keep planned behavior cases explicitly identified.
sprints[0].modules[0].cases[0][4]='Name, email, password and confirmation controls are readable and usable. The sign-in link switches to the login form.';
const importModule=sprints[1].modules.find(m=>m.code==='IMPORT');importModule.source=importModule.source.replace('ZipUpload.jsx','LocalUpload.jsx');
// Notification subscriptions are owned by Sprint 4, not the Sprint 2 job-status monitor.
const jobModule=sprints[1].modules.find(m=>m.code==='JOB');jobModule.cases=jobModule.cases.filter(c=>c[0]!=='Notification subscription identity');jobModule.source=jobModule.source.replace('; server/src/utils/socketSubscription.js','');
const config=sprints[1].modules.find(m=>m.code==='CONFIG');
config.cases[4][2]='PUT /api/projects/<P>/test-framework-selection with snapshotId and framework. Inspect the response and run the existing fixture tests.';
config.cases[4][3]='{"snapshotId":"<OWNED_READY_SNAPSHOT>","framework":"jest"}; repeat with vitest fixture.';
sprints[1].notes.push('Current-source contract checks also include explicit negative security and failure-handling expectations. Their presence is not a claim that the implementation passes. Execution is required to determine a verdict.');
 for(const sp of sprints){
 sp.notes.push(`Sprint source: C1SE.30_Sprint_COVAI_ver_1.0.xlsx, '${'Sprint '+sp.number}' sheet, ${sp.number===1?'planned B18:E53 and actual B60:E95':'planned B18:E43 and actual B50:E75'}. Task numbers and assigned members in the traceability table come from the plan.`);
 sp.notes.push('API setup: use the configured test API origin (default http://localhost:5000), Content-Type: application/json for JSON bodies and Authorization: Bearer <A_TOKEN> for protected A requests. Replace P/S/JOB_ID and angle-bracket placeholders with fixture project, snapshot, job and token values.');
 sp.notes.push('Verdicts: keep Not Run until attempted. Use Blocked when a required fixture or planned UI is unavailable. Record observed results and evidence in Actual results before selecting Pass or Fail. Module owners are QA assignments from the sprint, not execution signatures.');
 const wb=Workbook.create();const modules=sp.modules.map(m=>({...m,...drawModule(wb,sp,m)}));const report=drawReport(wb,sp,modules);
 wb.recalculate();
 const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:50},maxChars:3000});
 await fs.writeFile(path.join(dir,`formula-scan-${sp.number}.json`),errors.ndjson);
 const stats={sprint:sp.number,modules:modules.length,cases:modules.reduce((n,m)=>n+m.rows.length,0),tasks:report.taskCount,totalRow:report.total,moduleDetails:modules.map(m=>({name:m.name,count:m.rows.length,last:m.last,status:m.status,ids:m.ids,tasks:m.tasks}))};
 console.log('BUILT',JSON.stringify({sprint:stats.sprint,modules:stats.modules,cases:stats.cases,tasks:stats.tasks}));
 // Temporarily mutate one verdict to verify report recalculation, then restore every input.
 const first=modules[0];put(first.sheet,`${first.status}12`,'Pass');wb.recalculate();
 if(first.sheet.getRange('B7').values[0][0]!==1||report.sheet.getRange(`D${report.total}`).values[0][0]!==1)throw Error('Pass state did not recalculate');
 put(first.sheet,`${first.status}12`,'Blocked');wb.recalculate();
 if(report.sheet.getRange('H12').values[0][0]!==1)throw Error('Blocked state did not recalculate');
 put(first.sheet,`${first.status}12`,'Fail');wb.recalculate();
 if(report.sheet.getRange(`E${report.total}`).values[0][0]!==1)throw Error('Fail state did not recalculate');
 put(first.sheet,`${first.status}12`,'Not Run');wb.recalculate();
 if(report.sheet.getRange('H11').values[0][0]!==stats.cases||report.sheet.getRange('H9').values[0][0]!==0||report.sheet.getRange('H12').values[0][0]!==0)throw Error('Final result counts mismatch');
 const filename=`C1SE.30_TestCase Sprint${sp.number}_ver1.0.xlsx`;const output=await SpreadsheetFile.exportXlsx(wb);await output.save(path.join(dir,filename));
 await fs.writeFile(path.join(dir,`summary-${sp.number}.json`),JSON.stringify(stats,null,2));summary.push({...stats,filename});
 for(const m of modules){
  const blob=await wb.render({sheetName:m.name,range:`A11:${m.status}13`,scale:1,format:'png'});
  await fs.writeFile(path.join(dir,`preview-S${sp.number}-${m.code}.png`),new Uint8Array(await blob.arrayBuffer()));
 }
 const preview=await wb.render({sheetName:report.sheet.name,range:'A1:M24',scale:1,format:'png'});
 await fs.writeFile(path.join(dir,`report-S${sp.number}.png`),new Uint8Array(await preview.arrayBuffer()));
 const notesPreview=await wb.render({sheetName:report.sheet.name,range:'A25:M51',scale:1,format:'png'});
 await fs.writeFile(path.join(dir,`notes-S${sp.number}.png`),new Uint8Array(await notesPreview.arrayBuffer()));
 const metaPreview=await wb.render({sheetName:modules[0].name,range:'A1:C11',scale:1,format:'png'});
 await fs.writeFile(path.join(dir,`metadata-S${sp.number}.png`),new Uint8Array(await metaPreview.arrayBuffer()));
 console.log(`EXPORTED Sprint ${sp.number}, ${stats.cases} cases; dynamic counts verified`);
}
await fs.writeFile(path.join(dir,'summary.json'),JSON.stringify(summary,null,2));
