export const percentOrNull = (covered, total) => Number.isFinite(covered) && Number.isFinite(total) && total > 0 ? Math.round(covered * 1000 / total) / 10 : null;
export const scenarioIdentity = row => row.scenarioKey || `${row.filePath || row.testFile || ''}\0${row.title || ''}`;
export const formatReportDate = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) + ' ICT' : 'Not available';
