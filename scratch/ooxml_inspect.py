import re
import zipfile
from pathlib import Path

from lxml import etree

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
ROOT = Path(r"D:\HuuThuan - Project\NCKH\CovAI")

def qn(tag):
    prefix, local = tag.split(":")
    return f"{{{NS[prefix]}}}{local}"

def text(el):
    return "".join(el.itertext()) if el is not None else ""

def inspect_doc(path):
    print("\n===", path.name, "===")
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        doc = etree.fromstring(z.read("word/document.xml"))
        sects = doc.xpath(".//w:sectPr", namespaces=NS)
        print("sections", len(sects))
        for i, s in enumerate(sects, 1):
            pg = s.find(qn("w:pgSz")); mar = s.find(qn("w:pgMar"));
            print("section", i, "pgSz", pg.attrib if pg is not None else None, "pgMar", mar.attrib if mar is not None else None, "pgNumType", [x.attrib for x in s.findall(qn("w:pgNumType"))])
            print("  headers", [x.attrib for x in s.findall(qn("w:headerReference"))], "footers", [x.attrib for x in s.findall(qn("w:footerReference"))])
        st = etree.fromstring(z.read("word/styles.xml"))
        for style_id in ["Normal", "Heading1", "Heading2", "Heading3", "Title", "Caption", "TableParagraph", "Footer"]:
            els = st.xpath(f".//w:style[@w:styleId='{style_id}']", namespaces=NS)
            if not els: continue
            el=els[0]
            print("style", style_id, "name", [x.attrib for x in el.findall(qn("w:name"))], "based", [x.attrib for x in el.findall(qn("w:basedOn"))], "pPr", [etree.tostring(x,encoding='unicode') for x in el.findall(qn("w:pPr"))], "rPr", [etree.tostring(x,encoding='unicode') for x in el.findall(qn("w:rPr"))])
        settings = etree.fromstring(z.read("word/settings.xml"))
        print("updateFields", [x.attrib for x in settings.findall(qn("w:updateFields"))])
        for name in sorted(n for n in names if re.match(r"word/(header|footer)\d+\.xml$", n)):
            root=etree.fromstring(z.read(name)); print(name, "text=",repr(text(root)), "flds=",[x.attrib for x in root.xpath('.//w:fldSimple',namespaces=NS)], "instr=",[text(x) for x in root.xpath('.//w:instrText',namespaces=NS)])

inspect_doc(ROOT / "temp/C1SE.30_Proposal_ver1.2.docx")
inspect_doc(ROOT / "temp/C1SE.30_ProductBacklog_CovAI_ver1.1.docx")
