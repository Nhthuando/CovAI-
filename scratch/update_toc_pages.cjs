const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

(async () => {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'temp', 'C1SE.30_ProductBacklog_CovAI_ver1.1.docx');
  const scratch = path.join(__dirname, 'C1SE.30_ProductBacklog_CovAI_ver1.1.final.docx');
  const zip = await JSZip.loadAsync(fs.readFileSync(source));
  let xml = await zip.file('word/document.xml').async('string');
  const updates = [
    ['1.3.', 'System Overview', '7'],
    ['2.1.', 'Priority and Estimates', '8'],
    ['2.3.', 'Product Backlog Specification (User)', '11'],
    ['5.', 'References', '17'],
  ];
  const paragraphs = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  xml = xml.replace(paragraphs, (paragraph) => {
    const match = updates.find(([number, title]) => paragraph.includes(`<w:t>${number}\t${title}</w:t>`) || paragraph.includes(`<w:t>${number}.	${title}</w:t>`));
    if (!match) return paragraph;
    const page = match[2];
    const textNodes = [...paragraph.matchAll(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g)];
    if (!textNodes.length) return paragraph;
    const last = textNodes[textNodes.length - 1];
    const replacement = `<w:t${last[1]}>${page}</w:t>`;
    return paragraph.slice(0, last.index) + replacement + paragraph.slice(last.index + last[0].length);
  });
  zip.file('word/document.xml', xml);
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(source, output);
  fs.writeFileSync(scratch, output);
  console.log('Updated the four visible TOC page references to match the final layout.');
})();
