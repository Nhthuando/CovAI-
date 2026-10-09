from copy import deepcopy
from pathlib import Path
import re
import sys

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from openpyxl import load_workbook


ROOT = Path(r"D:\HuuThuan - Project\NCKH\CovAI")
INPUT = ROOT / "temp" / "C1SE.30_ProductBacklog_CovAI_ver1.1.docx"
XLSX = ROOT / "scratch" / "C1SE.20_ProductBacklog-UserStory_Storelens_v1.1.final.xlsx"
OUTPUT = ROOT / "scratch" / "C1SE.30_ProductBacklog_CovAI_ver1.1.final.docx"


def all_paragraphs(document):
    for paragraph in document.paragraphs:
        yield paragraph
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    yield paragraph
    for section in document.sections:
        for paragraph in section.header.paragraphs:
            yield paragraph
        for paragraph in section.footer.paragraphs:
            yield paragraph


def set_paragraph_text(paragraph, text):
    ppr = paragraph._p.pPr
    for child in list(paragraph._p):
        if child is not ppr:
            paragraph._p.remove(child)
    paragraph.add_run(text)


def set_cell_text(cell, text):
    cell.text = "" if text is None else str(text)


def remove_body_rows(table):
    for tr in list(table._tbl.tr_lst[1:]):
        table._tbl.remove(tr)


def set_table_rows(table, rows):
    if len(table.rows) < 2:
        raise ValueError("Target table needs one body row as a formatting template")
    template = deepcopy(table.rows[1]._tr)
    remove_body_rows(table)
    for values in rows:
        table._tbl.append(deepcopy(template))
        row = table.rows[-1]
        for index, value in enumerate(values):
            set_cell_text(row.cells[index], value)


def set_table_borders(table):
    """Restore explicit grid lines, including merged-cell edges, for Word renderers."""
    tbl_pr = table._tbl.tblPr
    tbl_borders = tbl_pr.first_child_found_in("w:tblBorders")
    if tbl_borders is None:
        tbl_borders = OxmlElement("w:tblBorders")
        tbl_pr.append(tbl_borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = qn(f"w:{edge}")
        element = tbl_borders.find(tag)
        if element is None:
            element = OxmlElement(f"w:{edge}")
            tbl_borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "4")
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), "000000")

    for cell in table._cells:
        tc_pr = cell._tc.get_or_add_tcPr()
        tc_borders = tc_pr.first_child_found_in("w:tcBorders")
        if tc_borders is None:
            tc_borders = OxmlElement("w:tcBorders")
            tc_pr.append(tc_borders)
        for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
            tag = qn(f"w:{edge}")
            element = tc_borders.find(tag)
            if element is None:
                element = OxmlElement(f"w:{edge}")
                tc_borders.append(element)
            element.set(qn("w:val"), "single")
            element.set(qn("w:sz"), "4")
            element.set(qn("w:space"), "0")
            element.set(qn("w:color"), "000000")


def set_style_font(style, name, size, color=None, bold=None, italic=None):
    style.font.name = name
    style._element.rPr.rFonts.set(qn("w:ascii"), name)
    style._element.rPr.rFonts.set(qn("w:hAnsi"), name)
    style._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    style.font.size = Pt(size)
    if color is not None:
        style.font.color.rgb = RGBColor(*color)
    if bold is not None:
        style.font.bold = bold
    if italic is not None:
        style.font.italic = italic


def style_runs(paragraph, name="Times New Roman", size=12, color=None, bold=None, italic=None):
    for run in paragraph.runs:
        run.font.name = name
        run._element.rPr.rFonts.set(qn("w:ascii"), name)
        run._element.rPr.rFonts.set(qn("w:hAnsi"), name)
        run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
        run.font.size = Pt(size)
        if color is not None:
            run.font.color.rgb = RGBColor(*color)
        if bold is not None:
            run.font.bold = bold
        if italic is not None:
            run.font.italic = italic


def add_field(paragraph, instruction, result):
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = f" {instruction} "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    result_run = OxmlElement("w:r")
    result_text = OxmlElement("w:t")
    result_text.text = str(result)
    result_run.append(result_text)
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run = OxmlElement("w:r")
    run.append(begin)
    run.append(instr)
    run.append(separate)
    paragraph._p.append(run)
    paragraph._p.append(result_run)
    paragraph._p.append(end)


def clear_paragraph_content(paragraph):
    ppr = paragraph._p.pPr
    for child in list(paragraph._p):
        if child is not ppr:
            paragraph._p.remove(child)


def add_bookmark(paragraph, bookmark_id, bookmark_name):
    start = OxmlElement("w:bookmarkStart")
    start.set(qn("w:id"), str(bookmark_id))
    start.set(qn("w:name"), bookmark_name)
    paragraph._p.append(start)
    return start


def end_bookmark(paragraph, bookmark_id):
    end = OxmlElement("w:bookmarkEnd")
    end.set(qn("w:id"), str(bookmark_id))
    paragraph._p.append(end)


def update_fields_on_open(document):
    settings = document.settings._element
    update = settings.find(qn("w:updateFields"))
    if update is None:
        update = OxmlElement("w:updateFields")
        settings.append(update)
    update.set(qn("w:val"), "true")


def format_footer(paragraph):
    clear_paragraph_content(paragraph)
    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
    fmt = paragraph.paragraph_format
    fmt.space_before = Pt(0)
    fmt.space_after = Pt(0)
    fmt.line_spacing = 1.0
    fmt.tab_stops.clear_all()
    fmt.tab_stops.add_tab_stop(Inches(3.25), WD_TAB_ALIGNMENT.CENTER, WD_TAB_LEADER.SPACES)
    fmt.tab_stops.add_tab_stop(Inches(6.5), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.SPACES)
    r = paragraph.add_run("C1SE.30\t\tPage ")
    r.font.name = "Times New Roman"
    r.font.size = Pt(9)
    add_field(paragraph, "PAGE", "1")
    r = paragraph.add_run(" of ")
    r.font.name = "Times New Roman"
    r.font.size = Pt(9)
    add_field(paragraph, "NUMPAGES", "16")
    for run in paragraph.runs:
        run.font.name = "Times New Roman"
        run._element.rPr.rFonts.set(qn("w:ascii"), "Times New Roman")
        run._element.rPr.rFonts.set(qn("w:hAnsi"), "Times New Roman")
        run.font.size = Pt(9)


def format_header(paragraph):
    clear_paragraph_content(paragraph)
    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
    fmt = paragraph.paragraph_format
    fmt.space_before = Pt(0)
    fmt.space_after = Pt(0)
    fmt.line_spacing = 1.0
    fmt.tab_stops.clear_all()
    fmt.tab_stops.add_tab_stop(Inches(3.25), WD_TAB_ALIGNMENT.CENTER, WD_TAB_LEADER.SPACES)
    fmt.tab_stops.add_tab_stop(Inches(6.5), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.SPACES)
    r = paragraph.add_run("PRODUCT BACKLOG\t   \t International School Capstone 1 – 2026")
    r.font.name = "Times New Roman"
    r.font.size = Pt(9)


def normalize_priority_tables(document):
    table = document.tables[4]
    values = [
        ["Priority Level", "Definition", "Scope & Criteria", "Target Sprints"],
        ["High", "Critical functionality required for the MVP and defense-ready core workflow.", "Authentication, project management, source ingestion, Docker test execution, coverage, AI test generation, chatbot evaluation, dashboard, end-to-end testing, and deployment.", "Sprint 1–7"],
        ["Medium", "Important analytical, automation, security, and operational capabilities that strengthen the MVP.", "CFG/complexity analysis, multi-framework adapters, queue monitoring, GitHub webhook automation, ground-truth management, diagnosis/comparison, and security verification.", "Sprint 3–7"],
        ["Low", "Useful non-blocking enhancements that can be deferred without preventing the core workflow.", "Real-time WebSocket notifications and other supplementary presentation or convenience improvements.", "Sprint 4"],
    ]
    for row, values_row in zip(table.rows, values):
        for cell, value in zip(row.cells, values_row):
            set_cell_text(cell, value)


def update_document_tables(document, stories):
    # Project information and contact details, using the Proposal/Project Plan values.
    project = document.tables[0]
    set_cell_text(project.cell(2, 3), "26 Dec 2026")
    set_cell_text(project.cell(11, 2), "quylavip333@gmail.com")
    set_cell_text(project.cell(11, 3), "0334814522")
    set_cell_text(project.cell(12, 1), "Thuan, Ngo Huu")
    set_cell_text(project.cell(12, 2), "thuanhuugl@gmail.com")
    set_cell_text(project.cell(12, 3), "0385591447")

    details = document.tables[2]
    set_cell_text(details.cell(1, 1), "Dinh, Huynh Tan; Ngo Huu Thuan")
    set_cell_text(details.cell(3, 1), "September 16th, 2026")
    set_cell_text(details.cell(3, 3), "C1SE.30_ProductBacklog_CovAI_ver1.1.docx")

    revision = document.tables[3]
    set_cell_text(revision.cell(2, 2), "16-Sep-2026")
    set_cell_text(revision.cell(2, 3), "Final handoff revision aligned with Proposal v1.2, Project Plan v1.1, the two-module Admin/User model, High/Medium/Low priorities, canonical Sprint 1 task hours, and the current 33-story backlog.")

    normalize_priority_tables(document)

    # Correct the authoritative sprint allocation and totals from the Project Plan.
    sprint_rows = [
        ["Sprint 1", "Environment Setup, Authentication & Project Management", "14 days", "Sep 14, 2026 – Sep 27, 2026", "336 hours"],
        ["Sprint 2", "Source Ingestion, Test Execution & Coverage Analysis", "14 days", "Sep 28, 2026 – Oct 11, 2026", "336 hours"],
        ["Sprint 3", "Code Analysis, Multi-Test Framework Support & AI Test Generation", "14 days", "Oct 12, 2026 – Oct 25, 2026", "336 hours"],
        ["Sprint 4", "GitHub Automation, Monitoring & System Integration", "6 days", "Oct 26, 2026 – Oct 31, 2026", "144 hours"],
        ["Sprint 5", "AI Chatbot Trustworthiness Evaluation Module", "14 days", "Nov 08, 2026 – Nov 21, 2026", "336 hours"],
        ["Sprint 6", "End-to-End System Testing & Quality Assurance", "7 days", "Nov 22, 2026 – Nov 28, 2026", "168 hours"],
        ["Sprint 7", "System Deployment, Final Fixes & Project Delivery", "11 days", "Nov 29, 2026 – Dec 09, 2026", "264 hours"],
        ["Total Development", "Total Development Effort across 7 Sprints (4 members @ 6h/day)", "80 days", "Sep 14, 2026 – Dec 09, 2026", "1,920 hours"],
        ["Total Project", "Total Committed Academic Man-Hours (including Initial Phase & Defense)", "107 days", "Aug 10, 2026 – Dec 26, 2026", "2,568 hours"],
    ]
    for row, values in zip(document.tables[5].rows[1:], sprint_rows):
        for cell, value in zip(row.cells, values):
            set_cell_text(cell, value)

    # Admin and User are the only product modules. The XLSX remains the canonical detailed story register.
    admin = sorted((story for story in stories if story[2] == "Admin"), key=lambda s: int(s[0][3:]))
    users = sorted((story for story in stories if story[2] == "User"), key=lambda s: int(s[0][3:]))

    def summary_row(story):
        story_id, heading, module, want, so_that, priority, sprint, estimate = story
        return [story_id, f"{heading} [{sprint} | {estimate}h]", module, want, so_that, priority]

    set_table_rows(document.tables[7], [summary_row(story) for story in admin])
    set_table_rows(document.tables[8], [summary_row(story) for story in users])

    constraints = document.tables[9]
    for row in constraints.rows:
        name = row.cells[0].text.strip()
        if name == "Economic & AI Budget":
            set_cell_text(row.cells[1], "Direct project budget is 800,000–1,150,000 VND (approximately 50 USD); student labor is non-billable academic effort. Content hashing (SHA-256) and snapshot caching control repeated analysis and AI token expenses.")
        elif name == "Hardware & OS":
            set_cell_text(row.cells[1], "Development is conducted on personal Windows 10/11 and Linux workstations. Server runtime requires Docker Engine 24+ and Node.js 20 LTS. Test sandboxes execute within <=1 GB RAM, <=1 vCPU, and a 30-second timeout.")

    # Keep project governance stakeholders, but explicitly state that they are not extra product modules.
    references = document.tables[11]
    reference_rows = [
        ["1", "https://www.scrum.org/resources/scrum-guide", "Scrum Guide & Agile Product Backlog Standards"],
        ["2", "https://www.mountaingoatsoftware.com/agile/scrum/product-backlog/example/", "Scrum Product Backlog Example & Estimation"],
        ["3", "C1SE.30_Proposal_ver1.2.pdf", "CovAI Project Proposal Document (version 1.2)"],
        ["4", "C1SE.30_ProjectPlan_ver_1.1-C1SE.30_Sprint1_COVAI_ver_1.0.pdf", "CovAI Project Plan & Sprint Schedule Document (version 1.1)"],
        ["5", "https://ai.google.dev/gemini-api/docs", "Google Gemini API Documentation"],
        ["6", "https://www.iso.org/standard/81291.html", "ISO/IEC/IEEE 29119 Software Testing Standards"],
        ["7", "https://www.iso.org/standard/35733.html", "ISO/IEC 25010 Systems and Software Quality Requirements and Evaluation"],
        ["8", "https://is.duytan.edu.vn/en/programs-curriculum/software-engineering/1/20/course-description-bachelor-degree-in-software-engineering/613", "Official CMU-SE 450 course description and staged capstone deliverables"],
    ]
    set_table_rows(references, reference_rows)


def read_xlsx_stories():
    workbook = load_workbook(XLSX, read_only=True, data_only=True)
    sheet = workbook["Product Backlog"]
    headers = [sheet.cell(7, column).value for column in range(2, 16)]
    normalized = [str(value or "").strip().lower().replace("\n", " ") for value in headers]
    def index_starting(prefix):
        for index, header in enumerate(normalized):
            if header.startswith(prefix):
                return index
        raise ValueError(f"Missing XLSX header: {prefix}")
    indices = {
        "id": index_starting("id"),
        "heading": index_starting("heading"),
        "module": index_starting("as a"),
        "want": index_starting("i want"),
        "so": index_starting("so that"),
        "priority": index_starting("priority"),
        "sprint": index_starting("sprint no"),
        "estimate": index_starting("estimate"),
    }
    stories = []
    for row_number in range(8, 41):
        values = [sheet.cell(row_number, column).value for column in range(2, 16)]
        story_id = str(values[indices["id"]] or "").strip()
        if not story_id:
            continue
        stories.append((
            story_id,
            str(values[indices["heading"]] or "").strip(),
            str(values[indices["module"]] or "").strip(),
            str(values[indices["want"]] or "").strip(),
            str(values[indices["so"]] or "").strip(),
            str(values[indices["priority"]] or "").strip(),
            str(values[indices["sprint"]] or "").strip(),
            int(values[indices["estimate"]]),
        ))
    workbook.close()
    if len(stories) != 33:
        raise ValueError(f"Expected 33 stories from the canonical XLSX, got {len(stories)}")
    if {story[2] for story in stories} != {"Admin", "User"}:
        raise ValueError("The canonical XLSX must contain only Admin and User modules")
    if {story[5] for story in stories} - {"High", "Medium", "Low"}:
        raise ValueError("Unexpected priority level in the canonical XLSX")
    return stories


def make_caption_fields(document):
    caption_number = 0
    caption_bookmarks = {}
    for paragraph in document.paragraphs:
        if paragraph.style.name.lower() == "table of figures":
            continue
        match = re.match(r"^Table\s+(\d+)\s+-\s*([^\t]+?)\s*$", paragraph.text.strip(), re.I)
        if not match:
            continue
        caption_number += 1
        number = int(match.group(1))
        title = match.group(2)
        paragraph.style = document.styles["Caption"]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.space_before = Pt(6)
        paragraph.paragraph_format.space_after = Pt(10)
        clear_paragraph_content(paragraph)
        bookmark_id = 100 + number
        bookmark_name = f"tbl{number}"
        add_bookmark(paragraph, bookmark_id, bookmark_name)
        run = paragraph.add_run("Table ")
        style_runs(paragraph, "Times New Roman", 11, italic=True)
        add_field(paragraph, "SEQ Table \\* ARABIC", str(number))
        run = paragraph.add_run(f" - {title}")
        run.font.name = "Times New Roman"
        run.font.size = Pt(11)
        run.font.italic = True
        end_bookmark(paragraph, bookmark_id)
        caption_bookmarks[number] = bookmark_name

    # Make the List of Tables page references update with the table captions in Word.
    for paragraph in document.paragraphs:
        match = re.match(r"^(Table\s+(\d+)\s+-\s*.+?)(?:\t+)(\d+)\s*$", paragraph.text.strip(), re.I)
        if not match:
            continue
        number = int(match.group(2))
        if number not in caption_bookmarks:
            continue
        title = match.group(1)
        old_page = match.group(3)
        clear_paragraph_content(paragraph)
        paragraph.add_run(title)
        paragraph.add_run("\t")
        add_field(paragraph, f"PAGEREF {caption_bookmarks[number]} \\h", old_page)


def format_document(document):
    # Proposal page geometry and section behavior.
    for index, section in enumerate(document.sections):
        section.page_width = Inches(11920 / 1440)
        section.page_height = Inches(16860 / 1440)
        section.left_margin = Inches(1701 / 1440)
        section.right_margin = Inches(1134 / 1440)
        section.top_margin = Inches(1134 / 1440)
        section.bottom_margin = Inches(900 / 1440 if index >= 4 else 1134 / 1440)
        section.header_distance = Inches(720 / 1440)
        section.footer_distance = Inches(720 / 1440)
        section.different_first_page_header_footer = index < 5

    styles = document.styles
    if "Caption" not in styles:
        styles.add_style("Caption", WD_STYLE_TYPE.PARAGRAPH)
    if "Table Paragraph" not in styles:
        styles.add_style("Table Paragraph", WD_STYLE_TYPE.PARAGRAPH)
    set_style_font(styles["Normal"], "Times New Roman", 12)
    styles["Normal"].paragraph_format.line_spacing = 1.5
    styles["Normal"].paragraph_format.space_after = Pt(6)
    styles["Normal"].paragraph_format.widow_control = True

    if "Heading 1" in styles:
        set_style_font(styles["Heading 1"], "Play", 20, (15, 71, 97), bold=True)
        styles["Heading 1"].paragraph_format.space_before = Pt(18)
        styles["Heading 1"].paragraph_format.space_after = Pt(4)
        styles["Heading 1"].paragraph_format.keep_with_next = True
        styles["Heading 1"].paragraph_format.keep_together = True
    if "Heading 2" in styles:
        set_style_font(styles["Heading 2"], "Play", 16, (15, 71, 97), bold=True)
        styles["Heading 2"].paragraph_format.space_before = Pt(8)
        styles["Heading 2"].paragraph_format.space_after = Pt(4)
        styles["Heading 2"].paragraph_format.keep_with_next = True
    if "Heading 3" in styles:
        set_style_font(styles["Heading 3"], "Aptos", 14, (15, 71, 97), bold=True)
        styles["Heading 3"].paragraph_format.space_before = Pt(8)
        styles["Heading 3"].paragraph_format.space_after = Pt(4)
    if "Title" in styles:
        set_style_font(styles["Title"], "Play", 28, (15, 71, 97), bold=True)
        styles["Title"].paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if "Caption" in styles:
        set_style_font(styles["Caption"], "Times New Roman", 11, italic=True)
        styles["Caption"].paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
        styles["Caption"].paragraph_format.space_after = Pt(10)
    if "Table Paragraph" in styles:
        set_style_font(styles["Table Paragraph"], "Times New Roman", 9.5)
        styles["Table Paragraph"].paragraph_format.line_spacing = 1.0
        styles["Table Paragraph"].paragraph_format.space_before = Pt(0)
        styles["Table Paragraph"].paragraph_format.space_after = Pt(0)

    # Apply the proposal's heading hierarchy only to the body. The cover's
    # "Product Backlog" label is intentionally a normal centered title.
    heading1 = {"1. Introduction", "2. Product Backlog", "3. Constraints", "4. Stakeholders and User Descriptions Summary", "5. References"}
    heading2 = {"1.1 Purpose", "1.2 Scope", "1.3 System Overview", "2.1 Priority and Estimates", "2.2 Product Backlog Specification (Admin)", "2.3 Product Backlog Specification (User)"}
    in_body = False
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if text == "1. Introduction":
            in_body = True
        if not in_body:
            continue
        if text in heading1:
            paragraph.style = styles["Heading 1"]
            style_runs(paragraph, "Play", 20, (15, 71, 97), bold=True)
        elif text in heading2:
            paragraph.style = styles["Heading 2"]
            style_runs(paragraph, "Play", 16, (15, 71, 97), bold=True)

    # Keep the provided cover layout and spacing from the original template.
    cover_text = {
        "International School", "Capstone Project 1", "CMU-SE 450 – C1SE.30",
        "Product Backlog", "2. Product Backlog", "Version 1.1",
        "Date: September 16th, 2026", "TEST COVERAGE ANALYSIS AND AI-DRIVEN TEST GENERATION SYSTEM",
        "Submitted by", "Dinh, Huynh Tan", "Phuc, Tran Huu", "Quy, Nguyen Duy",
        "Thuan, Ngo Huu", "Approved by", "Man, Nguyen Duc, Ph.D.",
    }
    for paragraph in document.paragraphs[:31]:
        text = paragraph.text.strip()
        paragraph.paragraph_format.space_before = None
        paragraph.paragraph_format.space_after = None
        paragraph.paragraph_format.line_spacing = 1.0
        if text in cover_text:
            paragraph.style = styles["Normal"]
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            if text == "International School":
                style_runs(paragraph, "Times New Roman", 14, bold=True)
            elif text == "Capstone Project 1":
                style_runs(paragraph, "Times New Roman", 20, bold=True)
            elif text == "CMU-SE 450 – C1SE.30":
                style_runs(paragraph, "Times New Roman", 13, bold=True)
            elif text in {"Product Backlog", "2. Product Backlog", "TEST COVERAGE ANALYSIS AND AI-DRIVEN TEST GENERATION SYSTEM"}:
                style_runs(paragraph, "Times New Roman", 20, bold=True)
            elif text in {"Submitted by", "Dinh, Huynh Tan", "Phuc, Tran Huu", "Quy, Nguyen Duy", "Thuan, Ngo Huu", "Approved by", "Man, Nguyen Duc, Ph.D."}:
                style_runs(paragraph, "Times New Roman", 13, bold=True)
            else:
                style_runs(paragraph, "Times New Roman", 13, bold=True)
            if text in {"Capstone Project 1", "CMU-SE 450 – C1SE.30", "Version 1.1", "Date: September 16th, 2026", "Approved by", "Man, Nguyen Duc, Ph.D."}:
                paragraph.paragraph_format.line_spacing = 1.5
            elif text == "Product Backlog":
                paragraph.paragraph_format.line_spacing = 1.5
            elif text == "TEST COVERAGE ANALYSIS AND AI-DRIVEN TEST GENERATION SYSTEM":
                paragraph.paragraph_format.line_spacing = 1.0

    # Signature prompts preserve the proposal's unnumbered, compact form.
    for paragraph in document.paragraphs[:31]:
        if paragraph.text.strip() in {"Proposal Review Panel Representative:", "Capstone Project 1- Mentor:"}:
            paragraph.paragraph_format.space_before = None
            paragraph.paragraph_format.space_after = None
            paragraph.paragraph_format.line_spacing = 1.0
            style_runs(paragraph, "Times New Roman", 13, bold=True)
        elif paragraph.text.strip() == "Name\t\t\tSignature\t\tDate":
            paragraph.paragraph_format.space_before = None
            paragraph.paragraph_format.space_after = None
            paragraph.paragraph_format.line_spacing = 1.0
            style_runs(paragraph, "Times New Roman", 13)

    # Body paragraphs follow the proposal's readable spacing; tables remain compact.
    cover_ids = {id(paragraph._p) for paragraph in document.paragraphs[:31]}
    for paragraph in document.paragraphs:
        if id(paragraph._p) in cover_ids:
            continue
        if paragraph.style.name not in {"Heading 1", "Heading 2", "Heading 3", "Caption", "table of figures"}:
            paragraph.paragraph_format.line_spacing = 1.5
            style_runs(paragraph, "Times New Roman", 12)

    for table in document.tables:
        set_table_borders(table)
        for row_index, row in enumerate(table.rows):
            for cell in row.cells:
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                for paragraph in cell.paragraphs:
                    paragraph.style = styles["Table Paragraph"] if "Table Paragraph" in styles else styles["Normal"]
                    paragraph.paragraph_format.line_spacing = 1.0
                    paragraph.paragraph_format.space_before = Pt(0)
                    paragraph.paragraph_format.space_after = Pt(0)
                    paragraph.paragraph_format.keep_together = True
                    style_runs(paragraph, "Times New Roman", 9.5, bold=(row_index == 0))

    # The supplied header/footer pattern is retained, with dynamic page fields.
    for section in document.sections:
        if section.header.paragraphs:
            format_header(section.header.paragraphs[0])
        if section.footer.paragraphs:
            format_footer(section.footer.paragraphs[0])


def main():
    if not XLSX.exists():
        raise FileNotFoundError(f"Canonical XLSX not found: {XLSX}")
    stories = read_xlsx_stories()
    document = Document(INPUT)

    # Remove four empty spacer paragraphs that split the approval block across
    # pages in the previous export. This restores the single-page cover layout
    # used by the Proposal template.
    cover_paragraphs = list(document.paragraphs)
    for position in (26, 24, 20, 18):
        paragraph = cover_paragraphs[position]
        if paragraph.text.strip() != "":
            raise ValueError(f"Expected an empty cover spacer at paragraph {position}")
        paragraph._element.getparent().remove(paragraph._element)

    # The retained pre-edit copy contains one outdated team member; Proposal v1.2 and
    # Project Plan v1.1 define the current four-person team.
    for paragraph in list(document.paragraphs):
        if paragraph.text.strip() == "Hien, Nguyen Thanh Long":
            paragraph._element.getparent().remove(paragraph._element)

    # Content corrections that are independent of table reconstruction.
    for index, paragraph in enumerate(document.paragraphs):
        if paragraph.text.strip() == "2. Product Backlog" and index < 70:
            set_paragraph_text(paragraph, "Product Backlog")
        if paragraph.text.strip() == "Date: September 10th, 2026":
            set_paragraph_text(paragraph, "Date: September 16th, 2026")
        if "The CovAI engineering effort encompasses" in paragraph.text:
            set_paragraph_text(paragraph, "The CovAI engineering effort encompasses 7 Agile/Scrum Sprints comprising 1,920 development hours. The companion XLSX records the detailed acceptance criteria, remarks, status, type, project ID, sprint number, and numeric estimate for each of the 33 canonical user stories. Sprint 1 is reconciled directly to the Project Plan: 36 tasks, 336 hours total, with Week 1 = 168 hours and Week 2 = 168 hours.")
        if "two core operational modules" in paragraph.text:
            set_paragraph_text(paragraph, "The Product Backlog defines exactly two operational modules: Admin and User. Developers, QA engineers, testers, AI engineers, domain experts, and project owners use the same User module to test and evaluate their projects; no additional product module is created for these project personas.")
        if paragraph.text.strip() == "4. Stakeholders and User Descriptions Summary":
            pass

    replacements = {
        "0835940026": "0334814522",
        "huuthuan280804@gmail.com": "thuanhuugl@gmail.com",
        "0981944510": "0385591447",
        "August 26th, 2026": "September 16th, 2026",
    }
    for paragraph in all_paragraphs(document):
        if not paragraph.text:
            continue
        text = paragraph.text
        for old, new in replacements.items():
            text = text.replace(old, new)
        if text != paragraph.text:
            set_paragraph_text(paragraph, text)

    update_document_tables(document, stories)
    if "Caption" not in document.styles:
        document.styles.add_style("Caption", WD_STYLE_TYPE.PARAGRAPH)
    if "Table Paragraph" not in document.styles:
        document.styles.add_style("Table Paragraph", WD_STYLE_TYPE.PARAGRAPH)
    make_caption_fields(document)
    format_document(document)
    update_fields_on_open(document)

    # Ensure all section page-number starts are continuous and the document remains editable.
    for section in document.sections:
        sect_pr = section._sectPr
        pg_num_type = sect_pr.find(qn("w:pgNumType"))
        if pg_num_type is not None:
            sect_pr.remove(pg_num_type)

    document.save(OUTPUT)
    print(f"Wrote {OUTPUT}")
    print(f"Stories: {len(stories)}; Admin: {sum(1 for s in stories if s[2] == 'Admin')}; User: {sum(1 for s in stories if s[2] == 'User')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
