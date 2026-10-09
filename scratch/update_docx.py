import docx
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Pt
from docx.table import _Cell
from copy import deepcopy

def set_run_font(run, name='Times New Roman', size_pt=13.0, bold=False, italic=False):
    run.font.name = name
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.italic = italic
    rPr = run._r.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    rFonts.set(qn('w:ascii'), name)
    rFonts.set(qn('w:hAnsi'), name)
    rFonts.set(qn('w:cs'), name)

def set_cell_text(cell, text, name='Times New Roman', size_pt=13.0, bold=False, italic=False, align=None):
    p = cell.paragraphs[0]
    p.text = ""
    if align is not None:
        p.alignment = align
    lines = text.split('\n')
    for idx, line in enumerate(lines):
        run = p.add_run(line)
        set_run_font(run, name=name, size_pt=size_pt, bold=bold, italic=italic)
        if idx < len(lines) - 1:
            p.add_run().add_break()
    for extra_p in cell.paragraphs[1:]:
        p_elem = extra_p._p
        p_elem.getparent().remove(p_elem)

def update_docx_backlog():
    docx_path = 'temp/C1SE.30_ProductBacklog_CovAI_ver1.1.docx'
    doc = docx.Document(docx_path)

    # Grab references to all original tables before inserting anything new
    t0 = doc.tables[0]
    t1 = doc.tables[1]
    t2 = doc.tables[2]
    t3 = doc.tables[3]
    t4 = doc.tables[4]
    t5 = doc.tables[5]
    t6 = doc.tables[6]
    t7 = doc.tables[7]
    t8 = doc.tables[8]
    t9 = doc.tables[9]

    # 1. Update cover page paragraphs
    # Cover page names: P12, P13, P14, P15, P16
    doc.paragraphs[12].text = "Dinh, Huynh Tan"
    set_run_font(doc.paragraphs[12].runs[0], size_pt=13.0)

    doc.paragraphs[13].text = "Phuc, Tran Huu"
    set_run_font(doc.paragraphs[13].runs[0], size_pt=13.0)

    doc.paragraphs[14].text = "Quy, Nguyen Duy"
    set_run_font(doc.paragraphs[14].runs[0], size_pt=13.0)

    doc.paragraphs[15].text = "Thuan, Ngo Huu"
    set_run_font(doc.paragraphs[15].runs[0], size_pt=13.0)

    # Remove P16
    p16 = doc.paragraphs[16]._p
    p16.getparent().remove(p16)

    # 2. Update Table 0 (PROJECT INFORMATION)
    set_cell_text(t0.rows[2].cells[3], "26 Dec 2026", size_pt=13.0)

    # Row 9: Dinh
    set_cell_text(t0.rows[9].cells[1], "Dinh, Huynh Tan", size_pt=13.0)
    set_cell_text(t0.rows[9].cells[2], "huynhtandinh.dev@gmail.com", size_pt=13.0)
    set_cell_text(t0.rows[9].cells[3], "0365472162", size_pt=13.0)

    # Row 10: Phuc
    set_cell_text(t0.rows[10].cells[1], "Phuc, Tran Huu", size_pt=13.0)
    set_cell_text(t0.rows[10].cells[2], "phuc12435az@gmail.com", size_pt=13.0)
    set_cell_text(t0.rows[10].cells[3], "0842644169", size_pt=13.0)

    # Row 11: Quy
    set_cell_text(t0.rows[11].cells[1], "Quy, Nguyen Duy", size_pt=13.0)
    set_cell_text(t0.rows[11].cells[2], "quylavip333@gmail.com", size_pt=13.0)
    set_cell_text(t0.rows[11].cells[3], "0334814522", size_pt=13.0)

    # Row 12: Thuan
    set_cell_text(t0.rows[12].cells[1], "Thuan, Ngo Huu", size_pt=13.0)
    set_cell_text(t0.rows[12].cells[2], "thuanhuugl@gmail.com", size_pt=13.0)
    set_cell_text(t0.rows[12].cells[3], "0385591447", size_pt=13.0)

    # Remove Row 13
    t0._tbl.remove(t0.rows[13]._tr)

    # 3. Update Table 1 (DOCUMENT APPROVALS)
    set_cell_text(t1.rows[0].cells[0], "Dinh, Huynh Tan\nStudent ID: 29219052500\nScrum Master", size_pt=13.0)
    set_cell_text(t1.rows[1].cells[0], "Phuc, Tran Huu\nStudent ID: 29211458179\nTeam Member", size_pt=13.0)
    set_cell_text(t1.rows[2].cells[0], "Quy, Nguyen Duy\nStudent ID: 29211158823\nTeam Member", size_pt=13.0)
    set_cell_text(t1.rows[3].cells[0], "Thuan, Ngo Huu\nStudent ID: 29219065178\nTeam Member", size_pt=13.0)
    t1._tbl.remove(t1.rows[4]._tr)

    # 4. Update Table 2 (DOCUMENT DETAILS)
    set_cell_text(t2.rows[1].cells[1], "Thuan, Ngo Huu & Dinh, Huynh Tan", size_pt=13.0)
    set_cell_text(t2.rows[2].cells[1], "Frontend Lead / Full-Stack Developer & Scrum Master", size_pt=13.0)
    set_cell_text(t2.rows[3].cells[1], "August 26th, 2026", size_pt=13.0)
    set_cell_text(t2.rows[3].cells[3], "C1SE.30_ProductBacklog_CovAI_ver1.1.docx", size_pt=13.0)

    # 5. Update Table 3 (REVISION HISTORY)
    set_cell_text(t3.rows[1].cells[0], "1.0", size_pt=13.0)
    set_cell_text(t3.rows[1].cells[1], "Thuan, Ngo Huu", size_pt=13.0)
    set_cell_text(t3.rows[1].cells[2], "22-Aug-2026", size_pt=13.0)
    set_cell_text(t3.rows[1].cells[3], "Create initial Product Backlog document based on Proposal", size_pt=13.0)

    set_cell_text(t3.rows[2].cells[0], "1.1", size_pt=13.0)
    set_cell_text(t3.rows[2].cells[1], "C1SE.30", size_pt=13.0)
    set_cell_text(t3.rows[2].cells[2], "10-Sep-2026", size_pt=13.0)
    set_cell_text(t3.rows[2].cells[3], "Update and synchronize Product Backlog with Proposal v1.2 & Project Plan v1.1: incorporate isolated Docker testing, multi-framework coverage, AST/CFG complexity analysis, AI test generation, and AI Chatbot Trustworthiness Evaluation module across 7 Sprints.", size_pt=13.0)

    # 6. Update Table 4 (References)
    set_cell_text(t4.rows[3].cells[1], "C1SE.30_Proposal_ver1.2.pdf", size_pt=13.0)
    set_cell_text(t4.rows[3].cells[2], "CovAI Project Proposal Document (ver 1.2)", size_pt=13.0)

    set_cell_text(t4.rows[4].cells[1], "C1SE.30_ProjectPlan_ver_1.1.pdf", size_pt=13.0)
    set_cell_text(t4.rows[4].cells[2], "CovAI Project Plan & Sprint 1 Schedule Document (ver 1.1)", size_pt=13.0)

    # 7. Update Introduction Paragraphs
    for p in doc.paragraphs:
        txt = p.text.strip()
        if txt.startswith("Lists everything that the product owner and Scrum team feel"):
            p.text = "Lists everything that the product owner and Scrum team feel should be included in the software they are developing for automated test coverage analysis, AI-driven test generation, and AI chatbot trustworthiness evaluation."
            set_run_font(p.runs[0], size_pt=13.0)
        elif txt.startswith("Lists the user roles (Administrator, Developer, QA Engineer"):
            p.text = "Lists the user roles (Administrator, Developer, QA Engineer / Tester, AI Evaluator / Domain Expert)."
            set_run_font(p.runs[0], size_pt=13.0)
        elif txt.startswith("Specifies all functional requirements and user stories across"):
            p.text = "Specifies all functional requirements (FR-01 to FR-16) and non-functional quality attributes (NFR-01 to NFR-08) across the CovAI platform."
            set_run_font(p.runs[0], size_pt=13.0)
        elif txt.startswith("Lists key capabilities including project ingestion"):
            p.text = "Lists key capabilities across two core pillars: (1) Software Testing & Coverage Intelligence: ZIP/GitHub ingestion, isolated Docker sandbox execution, Statement/Branch/Function/Line coverage, AST & interactive CFG visualization, Cyclomatic Complexity analysis, Google Gemini AI test skeleton and full test generation, multi-framework support (Jest, Vitest, Supertest, Cypress, Playwright), GitHub webhooks, and real-time WebSocket notifications; (2) AI Chatbot Trustworthiness Evaluation: Knowledge document ingestion, evaluation profile builder, scenario generation, multi-task evaluation runner (Knowledge Q&A, Usage Guidance, Action/Tool execution), tool/action safety verification, 3-layer trustworthiness scoring (Core Criteria, Task Module, Project Rules), diagnosis, and multi-version benchmark comparison."
            set_run_font(p.runs[0], size_pt=13.0)
        elif txt.startswith("Assigns priority levels (1 to 5) to each feature"):
            p.text = "Assigns priority levels (1 to 5) and estimated development effort (hours) to each user story aligned with the 7 Sprints of the project schedule."
            set_run_font(p.runs[0], size_pt=13.0)

    # 8. Update Table 8 (Constraints)
    set_cell_text(t8.rows[1].cells[1], "Project development duration is 18 weeks (from August 10, 2026 to December 26, 2026), structured into 7 Agile/Scrum Sprints: Sprint 1 (Environment Setup, Authentication & Project Management), Sprint 2 (Source Ingestion, Test Execution & Coverage Analysis), Sprint 3 (Code Analysis, Multi-Test Framework Support & AI Test Generation), Sprint 4 (GitHub Automation, Monitoring & System Integration), Sprint 5 (AI Chatbot Trustworthiness Evaluation Module), Sprint 6 (End-to-End System Testing & Quality Assurance), and Sprint 7 (System Deployment, Final Fixes & Project Delivery), followed by final document submission and Capstone defense.", size_pt=13.0)

    set_cell_text(t8.rows[2].cells[1], "The project is designed, engineered, and maintained by a dedicated team of 4 software engineering students from Duy Tan University (Dinh, Huynh Tan; Thuan, Ngo Huu; Phuc, Tran Huu; Quy, Nguyen Duy) under the academic supervision of Ph.D. Nguyen Duc Man. Total committed development effort is 2,568 man-hours (642 hours per member, based on 6 working hours/day).", size_pt=13.0)

    set_cell_text(t8.rows[3].cells[1], "Built on a decoupled modern architecture: React 19 + Vite (Frontend SPA), Express.js 5 (Backend REST API), Prisma ORM + PostgreSQL (Database), BullMQ + Redis (Asynchronous Background Job Queue), Docker Engine (Isolated Execution Sandbox), Babel Parser (AST & CFG analysis), and Google Gemini API (AI-assisted test generation & Chatbot Evaluation).", size_pt=13.0)

    set_cell_text(t8.rows[4].cells[1], "Source code uploaded via ZIP or GitHub is sanitized by stripping sensitive files (.env, .pem, .key, id_rsa); anti-archive bomb safeguards enforce limits of 200MB compressed and 1GB uncompressed; GitHub tokens and credentials are encrypted using AES-256-GCM; user access is protected by JWT authentication; dynamic test execution is strictly confined within resource-constrained Docker containers (max 2 CPU cores, 2GB RAM, 180s timeout, non-root user).", size_pt=13.0)

    set_cell_text(t8.rows[5].cells[1], "Total project labor is 2,568 academic man-hours (non-billable student effort) and $400 estimated cloud/infrastructure budget (PostgreSQL Neon, domain, and Google Gemini API limits). Content hashing (SHA-256) and snapshot caching are employed to cache AST/CFG and coverage analyses, preventing redundant computations and controlling token expenses.", size_pt=13.0)

    set_cell_text(t8.rows[6].cells[1], "Development strictly adheres to Product Owner requirements, Agile/Scrum empirical process control, ISO/IEC/IEEE 29119 Software Testing standards, ISO/IEC 25010 Software Quality models, and IEEE 830/29148 requirements specifications.", size_pt=13.0)

    if len(t8.rows) == 7:
        new_tr = deepcopy(t8.rows[6]._tr)
        t8._tbl.append(new_tr)
        c0 = _Cell(new_tr.findall(qn('w:tc'))[0], t8)
        c1 = _Cell(new_tr.findall(qn('w:tc'))[1], t8)
        set_cell_text(c0, "Safety & Real-World Protection", size_pt=13.0, bold=False)
        set_cell_text(c1, "Evaluation of action-oriented chatbots and dynamic test execution strictly avoids unintended real-world side effects through simulated tool environments, mandatory human confirmation rules for destructive actions, and strict rate limiting.", size_pt=13.0, bold=False)

    # 9. Update Table 9 (Stakeholders)
    set_cell_text(t9.rows[1].cells[0], "Product Owner", size_pt=13.0)
    set_cell_text(t9.rows[1].cells[1], "Provides product vision, defines acceptance criteria, reviews Sprint deliverables, and accepts system increments.", size_pt=13.0)
    set_cell_text(t9.rows[1].cells[2], "Duy Tan University / Man, Nguyen Duc, Ph.D.", size_pt=13.0)

    set_cell_text(t9.rows[2].cells[0], "Scrum Master / Project Leader", size_pt=13.0)
    set_cell_text(t9.rows[2].cells[1], "Leads agile processes, facilitates Daily Scrums and Sprint Planning, removes technical impediments, and ensures timely milestone delivery.", size_pt=13.0)
    set_cell_text(t9.rows[2].cells[2], "Dinh, Huynh Tan", size_pt=13.0)

    set_cell_text(t9.rows[3].cells[0], "Frontend Lead / Full-Stack Developer", size_pt=13.0)
    set_cell_text(t9.rows[3].cells[1], "Architects React 19 SPA, designs responsive UI/UX, interactive CFG graphs, real-time coverage dashboards, and notification components.", size_pt=13.0)
    set_cell_text(t9.rows[3].cells[2], "Thuan, Ngo Huu", size_pt=13.0)

    set_cell_text(t9.rows[4].cells[0], "Backend & Integration Developer", size_pt=13.0)
    set_cell_text(t9.rows[4].cells[1], "Builds RESTful APIs, database schema, BullMQ worker queues, Docker Sandbox isolation environments, and end-to-end integration.", size_pt=13.0)
    set_cell_text(t9.rows[4].cells[2], "Phuc, Tran Huu", size_pt=13.0)

    set_cell_text(t9.rows[5].cells[0], "Data & Full-Stack Developer", size_pt=13.0)
    set_cell_text(t9.rows[5].cells[1], "Develops data analysis pipelines, Babel AST parser, CFG generator, database query optimization, and UI modules.", size_pt=13.0)
    set_cell_text(t9.rows[5].cells[2], "Quy, Nguyen Duy", size_pt=13.0)

    set_cell_text(t9.rows[6].cells[0], "AI Evaluator / Domain Expert", size_pt=13.0)
    set_cell_text(t9.rows[6].cells[1], "Defines chatbot evaluation profiles, validates ground truth rules and expected actions, audits benchmark scenarios, and analyzes trustworthiness scores.", size_pt=13.0)
    set_cell_text(t9.rows[6].cells[2], "AI Evaluation Specialist / Domain Expert", size_pt=13.0)

    set_cell_text(t9.rows[7].cells[0], "System Administrator", size_pt=13.0)
    set_cell_text(t9.rows[7].cells[1], "Manages cloud infrastructure, Docker host environments, BullMQ queues, database backups, security audits, and Gemini API quotas.", size_pt=13.0)
    set_cell_text(t9.rows[7].cells[2], "C1SE.30 Team", size_pt=13.0)

    set_cell_text(t9.rows[8].cells[0], "Software Developer (End-User)", size_pt=13.0)
    set_cell_text(t9.rows[8].cells[1], "Primary user who imports projects, executes automated test suites, inspects coverage/CFG graphs, and generates test cases via AI.", size_pt=13.0)
    set_cell_text(t9.rows[8].cells[2], "Software Developers & Students", size_pt=13.0)

    if len(t9.rows) == 9:
        new_tr = deepcopy(t9.rows[8]._tr)
        t9._tbl.append(new_tr)
        c0 = _Cell(new_tr.findall(qn('w:tc'))[0], t9)
        c1 = _Cell(new_tr.findall(qn('w:tc'))[1], t9)
        c2 = _Cell(new_tr.findall(qn('w:tc'))[2], t9)
        set_cell_text(c0, "QA Engineer / Tester (End-User)", size_pt=13.0)
        set_cell_text(c1, "Evaluates test coverage metrics, traces requirements to tests, prioritizes coverage gaps, audits AI-generated tests, and exports quality reports.", size_pt=13.0)
        set_cell_text(c2, "QA Engineers & Testers", size_pt=13.0)

    # 10. Now insert Table 4 (AI Evaluator / Domain Expert) right after Table 7
    tbl7_elem = t7._tbl

    # Create title paragraph for new table
    title_p = parse_xml(r'<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="26"/><w:szCs w:val="26"/><w:b/></w:rPr><w:t>Table 4: Product Backlog Specification (AI Evaluator / Domain Expert)</w:t></w:r></w:p>')
    tbl7_elem.addnext(title_p)

    # Create new table by cloning Table 7 structure
    new_tbl_elem = deepcopy(tbl7_elem)
    trs = new_tbl_elem.findall(qn('w:tr'))
    header_tr = trs[0]
    for tr in trs[1:]:
        new_tbl_elem.remove(tr)

    ai_eval_items = [
        ("PB01", "AI Knowledge Ingestion", "AI Evaluator", "Upload business documents, API specifications, and operational rule sets", "I can establish project ground truth for chatbot evaluation", "4"),
        ("PB02", "Evaluation Profile & Scenarios", "AI Evaluator", "Configure chatbot endpoints and generate benchmark test scenarios (Q&A, Guidance, Action)", "I have a comprehensive benchmark dataset tailored to the project", "5"),
        ("PB03", "Domain Expert Rule Confirmation", "Domain Expert", "Review, edit, and confirm ground truth facts, expected UI steps, and forbidden actions", "The evaluation benchmark accurately reflects verified business logic", "4"),
        ("PB04", "Multi-Task Evaluation Runner", "AI Evaluator", "Run automated evaluation suites against target chatbot and record responses & latency", "I can collect empirical evidence of chatbot performance across all test scenarios", "5"),
        ("PB05", "Tool & Action Verification", "AI Evaluator", "Verify tool selection accuracy, parameter schemas, safety confirmations, and forbidden actions", "I can prevent risky side-effects and ensure chatbot adheres to tool permission policies", "5"),
        ("PB06", "3-Layer Trustworthiness Scoring", "AI Evaluator", "Calculate composite scores across Core Criteria, Task Module, and Project Rules", "I obtain objective metrics on Correctness, Faithfulness, Hallucination, Safety, and Latency", "5"),
        ("PB07", "Diagnosis & Improvement", "AI Evaluator", "View detailed error diagnostics, hallucination logs, and AI-recommended improvements", "I can identify root causes of chatbot failures and guide model/prompt optimization", "4"),
        ("PB08", "Benchmark Comparison & Report", "AI Evaluator", "Compare multiple chatbot versions/models under same profile and export formal reports", "I can track quality improvements over iterations and present evidence to stakeholders", "4"),
    ]

    template_data_tr = t7.rows[1]._tr

    for id_val, theme, as_a, want, so_that, prio in ai_eval_items:
        row_elem = deepcopy(template_data_tr)
        t_cell_elems = row_elem.findall(qn('w:tc'))
        row_data = [id_val, theme, as_a, want, so_that, prio]
        for i, val in enumerate(row_data):
            c = _Cell(t_cell_elems[i], t7)
            set_cell_text(c, val, size_pt=13.0)
        new_tbl_elem.append(row_elem)

    title_p.addnext(new_tbl_elem)

    # Renumber subsequent table titles:
    for p in doc.paragraphs:
        if p.text.strip() == "Table 4: Constraint":
            p.text = "Table 5: Constraint"
            set_run_font(p.runs[0], size_pt=13.0, bold=True)
        elif p.text.strip() == "Table 5: Stakeholders and User Descriptions Summary":
            p.text = "Table 6: Stakeholders and User Descriptions Summary"
            set_run_font(p.runs[0], size_pt=13.0, bold=True)

    doc.save(docx_path)
    print(f"Successfully updated docx at {docx_path}")

if __name__ == '__main__':
    update_docx_backlog()
