"""Render export samples and check text bounds using the local PDF review runtime."""
from pathlib import Path
import pdfplumber
import pypdfium2 as pdfium

for source in [Path("output/pdf/covai-analysis-report-demo.pdf"), Path("tmp/pdfs/covai-analysis-report-empty.pdf")]:
    with pdfplumber.open(source) as pdf:
        for index, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            assert "CovAI" in text, (source, index, "missing header")
            assert f"{index + 1} / {len(pdf.pages)}" in text, (source, index, "missing page number")
            assert all(0 <= char["x0"] < char["x1"] <= page.width + 1 and 0 <= char["top"] < char["bottom"] <= page.height for char in page.chars), (source, index, "text outside page")
        assert "Dự án" in (pdf.pages[0].extract_text() or ""), "Vietnamese text did not survive export"
        print(f"{source.name}: {len(pdf.pages)} pages; headers, numbering, Unicode and text bounds passed")
    document = pdfium.PdfDocument(str(source))
    for index in range(len(document)):
        page = document[index]
        bitmap = page.render(scale=1.3)
        # Keep the PDFium bitmap alive while saving; to_pil can share its memory.
        bitmap.to_pil().save(Path("tmp/pdfs") / f"{source.stem}-{index + 1}.png")
        bitmap.close()
        page.close()
    document.close()
