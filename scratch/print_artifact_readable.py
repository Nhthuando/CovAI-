import json
from pathlib import Path

ROOT = Path(r"D:\HuuThuan - Project\NCKH\CovAI")
data = json.loads((ROOT / "scratch/source_analysis.json").read_text(encoding="utf-8"))

def cell_text(cell):
    vals = []
    for p in cell:
        if isinstance(p, dict):
            v = p.get("text", "")
        else:
            v = str(p)
        if v:
            vals.append(v)
    return " / ".join(vals).replace("\n", " ").strip()

def write_doc(key, out_name):
    x = data[key]
    lines = [f"FILE: {x['path']}", f"sha256: {x['sha256']}", f"paragraphs: {x['paragraph_count']}; tables: {x['table_count']}; sections: {x['section_count']}", ""]
    lines.append("BODY PARAGRAPHS")
    for i, p in enumerate(x["body"]["paragraphs"]):
        if p["text"].strip():
            lines.append(f"P{i:03d} [{p['style']}] {p['text']}")
    lines.append("\nTABLES")
    for ti, t in enumerate(x["body"]["tables"]):
        lines.append(f"TABLE {ti+1}: {t['rows']}x{t['cols']}")
        for ri, row in enumerate(t["data"]):
            lines.append(f"R{ri+1:02d}: " + " || ".join(cell_text(c) for c in row))
    lines.append("\nSECTIONS / HEADERS / FOOTERS")
    for si, sec in enumerate(x["sections"]):
        lines.append(f"SECTION {si+1}: page {sec['page_width_in']}x{sec['page_height_in']} in; margins T{sec['top_margin_in']} B{sec['bottom_margin_in']} L{sec['left_margin_in']} R{sec['right_margin_in']}; header {sec['header_distance_in']}; footer {sec['footer_distance_in']}")
        for p in sec["header"]["paragraphs"]:
            if p["text"].strip(): lines.append(f"HEADER [{p['style']}] {p['text']}")
        for p in sec["footer"]["paragraphs"]:
            if p["text"].strip(): lines.append(f"FOOTER [{p['style']}] {p['text']}")
    (ROOT / f"scratch/{out_name}").write_text("\n".join(lines), encoding="utf-8")

def write_xlsx(key, out_name):
    x = data[key]
    lines = [f"FILE: {x['path']}", f"sha256: {x['sha256']}", f"sheets: {x['sheet_count']}", ""]
    for s in x["sheets"]:
        lines.append(f"SHEET {s['title']}: max {s['max_row']}x{s['max_column']}; merged={s['merged_ranges']}; freeze={s['freeze_panes']}; gridlines={s['sheet_view_show_gridLines']}; print_area={s['print_area']}")
        lines.append(f"tables={s['tables']}")
        for row in s["nonempty_rows"]:
            lines.append(f"R{row['row']:03d}: " + " || ".join("" if v is None else str(v) for v in row["values"]))
        lines.append("")
    (ROOT / f"scratch/{out_name}").write_text("\n".join(lines), encoding="utf-8")

write_doc("proposal_docx", "proposal_docx_readable.txt")
write_doc("backlog_docx", "backlog_docx_readable.txt")
write_xlsx("backlog_xlsx", "backlog_xlsx_readable.txt")
write_xlsx("backlog_xlsx_bak", "backlog_xlsx_bak_readable.txt")
print("wrote readable artifact summaries")
