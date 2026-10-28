const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

(async () => {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'temp', 'C1SE.30_ProductBacklog_CovAI_ver1.1.docx');
  const scratch = path.join(__dirname, 'C1SE.30_ProductBacklog_CovAI_ver1.1.final.docx');
  const zip = await JSZip.loadAsync(fs.readFileSync(source));
  let xml = await zip.file('word/document.xml').async('string');
  const broken = /<w:tab\/>(\d+)<\/w:t>/g;
  const matches = [...xml.matchAll(broken)];
  if (matches.length !== 4) throw new Error(`Expected 4 malformed TOC page nodes, found ${matches.length}`);
  xml = xml.replace(broken, '<w:tab/><w:t>$1</w:t>');
  zip.file('word/document.xml', xml);
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(source, output);
  fs.writeFileSync(scratch, output);
  console.log(`Repaired ${matches.length} malformed TOC page nodes.`);
})();
