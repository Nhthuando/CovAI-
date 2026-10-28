const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

(async () => {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'temp', 'C1SE.30_ProductBacklog_CovAI_ver1.1.docx');
  const scratch = path.join(__dirname, 'C1SE.30_ProductBacklog_CovAI_ver1.1.final.docx');
  const zip = await JSZip.loadAsync(fs.readFileSync(source));
  const entry = zip.file('word/document.xml');
  let xml = await entry.async('string');
  const ids = ['168F44EF', '3402DA99'];
  for (const id of ids) {
    const pattern = new RegExp(`<w:p\\b[^>]*w14:paraId="${id}"[^>]*>[\\s\\S]*?<\\/w:p>`, 'g');
    const before = xml;
    xml = xml.replace(pattern, '');
    if (xml === before) throw new Error(`Could not remove page-break paragraph ${id}`);
  }
  zip.file('word/document.xml', xml);
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(source, output);
  fs.writeFileSync(scratch, output);
  console.log(`Removed ${ids.length} blank-page breaks and updated ${source}`);
})();
