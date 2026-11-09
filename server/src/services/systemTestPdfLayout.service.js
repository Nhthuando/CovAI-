export const PDF_COLORS = { ink:'#172338', muted:'#627184', rule:'#dce3eb', paper:'#f3f6fa', accent:'#4755c7', passed:'#07856b', failed:'#cb3156', flaky:'#b56a10', skipped:'#788599', blocked:'#7a56b6', canceled:'#687385', notRun:'#a0aabb' };
export const pdfText = value => String(value ?? 'Not available').replace(/[\u0000-\u0008\u000b-\u001f]/g,' ').normalize('NFC');
export const formatPdfDate = value => value ? new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour12:false})+' ICT' : 'Not available';
export const formatPdfCounter = value => value && value.total>0 && Number.isFinite(value.pct) ? `${value.covered}/${value.total} (${value.pct.toFixed(1)}%)` : 'Not measured';
