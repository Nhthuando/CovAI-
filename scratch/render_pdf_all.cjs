const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfPath = path.resolve(__dirname, 'C1SE.30_ProductBacklog_CovAI_ver1.1.rendered.pdf');
  const outDir = path.resolve(__dirname, 'docx_visual_all');
  fs.mkdirSync(outDir, { recursive: true });
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)) }).promise;
  const scale = 1.5;
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const filename = path.join(outDir, `page-${String(i).padStart(2, '0')}.png`);
    fs.writeFileSync(filename, canvas.toBuffer('image/png'));
  }
  console.log(`Rendered ${pdf.numPages} pages to ${outDir}`);
})();
