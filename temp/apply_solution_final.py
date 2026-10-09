import zipfile
import re
import subprocess

PROPOSAL = r'D:\HuuThuan - Project\NCKH\CovAI\temp\C1SE.30_Proposal_ver1.2.docx'
BACKUP = r'D:\HuuThuan - Project\NCKH\CovAI\temp\C1SE.30_ProductBacklog_CovAI_ver1.1.pre_mod.bak'
OUTPUT = r'D:\HuuThuan - Project\NCKH\CovAI\temp\C1SE.30_ProductBacklog_CovAI_ver1.1.docx'

print('Step 1: Reading template and source...')
with zipfile.ZipFile(PROPOSAL) as pz:
    p_files = {name: pz.read(name) for name in pz.namelist()}

with zipfile.ZipFile(BACKUP) as bz:
    b_files = {name: bz.read(name) for name in bz.namelist()}

cur_files = dict(b_files)

print('Step 2: Configuring Header...')
# Header2 (from Proposal header1.xml)
p_header_xml = p_files['word/header1.xml'].decode('utf-8')
b_header_xml = p_header_xml.replace('<w:t>PROPOSAL</w:t>', '<w:t>PRODUCT BACKLOG</w:t>')
b_header_xml = b_header_xml.replace('<a:schemeClr val="accent4"/>', '<a:srgbClr val="0F9ED5"/>')
cur_files['word/header2.xml'] = b_header_xml.encode('utf-8')

empty_hdr = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p></w:hdr>'''.encode('utf-8')
cur_files['word/header1.xml'] = empty_hdr
cur_files['word/header3.xml'] = empty_hdr

print('Step 3: Configuring Footer...')
# Footer2 (from Proposal footer6.xml)
p_footer_xml = p_files['word/footer6.xml'].decode('utf-8')
b_footer_xml = p_footer_xml.replace('<w:t>31</w:t>', '<w:t>20</w:t>')
cur_files['word/footer2.xml'] = b_footer_xml.encode('utf-8')

empty_ftr = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr></w:p></w:ftr>'''.encode('utf-8')
cur_files['word/footer1.xml'] = empty_ftr
cur_files['word/footer3.xml'] = empty_ftr

print('Step 4: Configuring Theme color...')
theme_xml = b_files['word/theme/theme1.xml'].decode('utf-8')
theme_xml = re.sub(
    r'(<a:accent4>\s*<a:srgbClr val=")[^"]*(")',
    r'\g<1>0F9ED5\2',
    theme_xml
)
cur_files['word/theme/theme1.xml'] = theme_xml.encode('utf-8')

print('Step 5: Configuring Styles...')
styles_str = b_files['word/styles.xml'].decode('utf-8')
extra_styles = '''<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="35"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="200" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="0E2841" w:themeColor="text2"/><w:szCs w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableofFigures"><w:name w:val="table of figures"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1" w:themeColor="hyperlink"/><w:u w:val="single"/></w:rPr></w:style>'''
styles_str = styles_str.replace('</w:styles>', extra_styles + '</w:styles>')
cur_files['word/styles.xml'] = styles_str.encode('utf-8')

print('Step 6: Modifying document.xml...')
doc_xml = b_files['word/document.xml'].decode('utf-8')

# 6A. Section 0: Default header/footer to rId14/rId15 (empty)
old_sec0 = '<w:sectPr w:rsidR="00AF4A28" w:rsidSect="00EB5832"><w:headerReference w:type="even" r:id="rId10"/><w:headerReference w:type="default" r:id="rId11"/><w:footerReference w:type="even" r:id="rId12"/><w:footerReference w:type="default" r:id="rId13"/><w:headerReference w:type="first" r:id="rId14"/><w:footerReference w:type="first" r:id="rId15"/><w:pgSz w:w="11920" w:h="16860"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:pgBorders w:display="firstPage"><w:top w:val="single" w:sz="12" w:space="2" w:color="auto"/><w:left w:val="single" w:sz="12" w:space="4" w:color="auto"/><w:bottom w:val="single" w:sz="12" w:space="2" w:color="auto"/><w:right w:val="single" w:sz="12" w:space="4" w:color="auto"/></w:pgBorders><w:cols w:space="720"/><w:titlePg/><w:docGrid w:linePitch="326"/></w:sectPr>'
new_sec0 = '<w:sectPr w:rsidR="00AF4A28" w:rsidSect="00EB5832"><w:headerReference w:type="even" r:id="rId10"/><w:headerReference w:type="default" r:id="rId14"/><w:footerReference w:type="even" r:id="rId12"/><w:footerReference w:type="default" r:id="rId15"/><w:headerReference w:type="first" r:id="rId14"/><w:footerReference w:type="first" r:id="rId15"/><w:pgSz w:w="11920" w:h="16860"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:pgBorders w:display="firstPage"><w:top w:val="single" w:sz="12" w:space="2" w:color="auto"/><w:left w:val="single" w:sz="12" w:space="4" w:color="auto"/><w:bottom w:val="single" w:sz="12" w:space="2" w:color="auto"/><w:right w:val="single" w:sz="12" w:space="4" w:color="auto"/></w:pgBorders><w:cols w:space="720"/><w:titlePg/><w:docGrid w:linePitch="326"/></w:sectPr>'
assert old_sec0 in doc_xml, 'old_sec0 not found'
doc_xml = doc_xml.replace(old_sec0, new_sec0)

# 6B. Section 5: Add headerReference rId11, footerReference rId13, margins, pgNumType start="1"
old_sec5 = '<w:sectPr w:rsidR="005331E3" w:rsidRPr="009C318A" w:rsidSect="009C318A"><w:pgSz w:w="11920" w:h="16860"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="326"/></w:sectPr>'
new_sec5 = '<w:sectPr w:rsidR="005331E3" w:rsidRPr="009C318A" w:rsidSect="009C318A"><w:headerReference w:type="default" r:id="rId11"/><w:footerReference w:type="default" r:id="rId13"/><w:headerReference w:type="first" r:id="rId11"/><w:footerReference w:type="first" r:id="rId13"/><w:pgSz w:w="11920" w:h="16860"/><w:pgMar w:top="1134" w:right="1134" w:bottom="900" w:left="1701" w:header="720" w:footer="720" w:gutter="0"/><w:pgNumType w:start="1"/><w:cols w:space="720"/><w:docGrid w:linePitch="354"/></w:sectPr>'
assert old_sec5 in doc_xml, 'old_sec5 not found'
doc_xml = doc_xml.replace(old_sec5, new_sec5)

# 6C. Replace 8 captions using exact bookmarks tbl5..tbl12
TABLE_INFO = [
    ("tbl5", "1", "Priority Definition", "_Toc240500001", "201"),
    ("tbl6", "2", "Development Effort and Sprint Allocation", "_Toc240500002", "202"),
    ("tbl7", "3", "Sprint 1 Work Breakdown (Week 1 &amp; Week 2)", "_Toc240500003", "203"),
    ("tbl8", "4", "Product Backlog Specification (Admin)", "_Toc240500004", "204"),
    ("tbl9", "5", "Product Backlog Specification (User)", "_Toc240500005", "205"),
    ("tbl10", "6", "Constraints", "_Toc240500006", "206"),
    ("tbl11", "7", "Stakeholders and User Descriptions Summary", "_Toc240500007", "207"),
    ("tbl12", "8", "References", "_Toc240500008", "208"),
]

for tbl_name, num_str, title_xml, toc_bm, toc_id in TABLE_INFO:
    bm_str = f'w:name="{tbl_name}"'
    bm_pos = doc_xml.find(bm_str)
    assert bm_pos != -1, f'{tbl_name} not found'
    p_start = doc_xml.rfind('<w:p ', 0, bm_pos)
    p_end = doc_xml.find('</w:p>', bm_pos) + 6
    orig_p = doc_xml[p_start:p_end]
    
    m_id = re.search(r'w:bookmarkStart\s+w:id="(\d+)"\s+w:name="' + tbl_name + '"', orig_p)
    orig_id = m_id.group(1) if m_id else "9"
    
    new_p = f'<w:p><w:pPr><w:pStyle w:val="Caption"/><w:keepNext/></w:pPr><w:bookmarkStart w:id="{orig_id}" w:name="{tbl_name}"/><w:bookmarkStart w:id="{toc_id}" w:name="{toc_bm}"/><w:r><w:t xml:space="preserve">Table </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> SEQ Table \\* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:noProof/></w:rPr><w:t>{num_str}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> - </w:t></w:r><w:r><w:t>{title_xml}</w:t></w:r><w:bookmarkEnd w:id="{toc_id}"/><w:bookmarkEnd w:id="{orig_id}"/></w:p>'
    doc_xml = doc_xml.replace(orig_p, new_p)
    print(f'   Replaced caption for {tbl_name}')

# 6D. Insert LOT into Section 4
lot_xml = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
lot_xml += '<w:p><w:pPr><w:pStyle w:val="TableofFigures"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9075"/></w:tabs><w:jc w:val="center"/><w:rPr><w:b/><w:bCs/><w:noProof/><w:color w:val="000000"/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:bCs/><w:noProof/><w:color w:val="000000"/></w:rPr><w:t xml:space="preserve">LIST OF </w:t></w:r><w:r><w:rPr><w:b/><w:bCs/><w:noProof/><w:color w:val="000000"/></w:rPr><w:t>TABLES</w:t></w:r></w:p>'

TABLES_LOT = [
    ("1", "Priority Definition", "_Toc240500001", "3"),
    ("2", "Development Effort and Sprint Allocation", "_Toc240500002", "4"),
    ("3", "Sprint 1 Work Breakdown (Week 1 &amp; Week 2)", "_Toc240500003", "5"),
    ("4", "Product Backlog Specification (Admin)", "_Toc240500004", "8"),
    ("5", "Product Backlog Specification (User)", "_Toc240500005", "9"),
    ("6", "Constraints", "_Toc240500006", "17"),
    ("7", "Stakeholders and User Descriptions Summary", "_Toc240500007", "18"),
    ("8", "References", "_Toc240500008", "19"),
]

for i, (num_str, title_xml, bm_name, page_str) in enumerate(TABLES_LOT):
    begin_fld = ''
    if i == 0:
        begin_fld = '<w:r><w:rPr><w:noProof/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:noProof/></w:rPr><w:instrText xml:space="preserve"> TOC \\h \\z \\c "Table" </w:instrText></w:r><w:r><w:rPr><w:noProof/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>'
    end_fld = ''
    if i == len(TABLES_LOT) - 1:
        end_fld = '<w:r><w:rPr><w:noProof/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>'
    
    entry_p = f'<w:p><w:pPr><w:pStyle w:val="TableofFigures"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9075"/></w:tabs><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/><w:noProof/><w:kern w:val="2"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr>{begin_fld}<w:hyperlink w:anchor="{bm_name}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/><w:noProof/></w:rPr><w:t>Table {num_str} - {title_xml}</w:t></w:r><w:r><w:rPr><w:noProof/><w:webHidden/></w:rPr><w:tab/></w:r><w:r><w:rPr><w:noProof/><w:webHidden/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:noProof/><w:webHidden/></w:rPr><w:instrText xml:space="preserve"> PAGEREF {bm_name} \\h </w:instrText></w:r><w:r><w:rPr><w:noProof/><w:webHidden/></w:rPr></w:r><w:r><w:rPr><w:noProof/><w:webHidden/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:noProof/><w:webHidden/></w:rPr><w:t>{page_str}</w:t></w:r><w:r><w:rPr><w:noProof/><w:webHidden/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink>{end_fld}</w:p>'
    lot_xml += entry_p

sec4_end_p_marker = '<w:p w14:paraId="07066215"'
assert sec4_end_p_marker in doc_xml, 'sec4_end_p_marker not found'
doc_xml = doc_xml.replace(sec4_end_p_marker, lot_xml + sec4_end_p_marker)
print('   Inserted LOT XML before Section 4 sectPr paragraph')

cur_files['word/document.xml'] = doc_xml.encode('utf-8')

print('Step 7: Writing output docx archive...')
with zipfile.ZipFile(OUTPUT, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for name, data in cur_files.items():
        z.writestr(name, data)

print('Step 8: Updating fields and saving via Word COM...')
ps_update_cmd = f'''
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
try {{
    $doc = $w.Documents.Open("{OUTPUT}")
    $doc.Fields.Update()
    $doc.Save()
    $doc.Close($false)
    Write-Host "Fields updated and document saved successfully!"
}} catch {{
    Write-Host "ERROR: $_"
    exit 1
}} finally {{
    $w.Quit()
}}
'''

with open('temp/temp_update.ps1', 'w', encoding='utf-8') as f:
    f.write(ps_update_cmd)

res = subprocess.run(['powershell', '-ExecutionPolicy', 'Bypass', '-File', 'temp/temp_update.ps1'], capture_output=True, text=True)
print(res.stdout)

print('Step 9: Verifying clean open with DisplayAlerts = -1 (wdAlertsAll)...')
ps_verify_cmd = f'''
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = -1
try {{
    $doc = $w.Documents.Open("{OUTPUT}")
    $pages = $doc.ComputeStatistics(2)
    Write-Host "VERIFICATION PASSED: Document opened cleanly with $pages pages, ZERO alerts!"
    $doc.Close($false)
    exit 0
}} catch {{
    Write-Host "VERIFICATION FAILED: $_"
    exit 1
}} finally {{
    $w.Quit()
}}
'''

with open('temp/temp_verify.ps1', 'w', encoding='utf-8') as f:
    f.write(ps_verify_cmd)

res_v = subprocess.run(['powershell', '-ExecutionPolicy', 'Bypass', '-File', 'temp/temp_verify.ps1'], capture_output=True, text=True)
print(res_v.stdout)
if res_v.returncode == 0 and 'VERIFICATION PASSED' in res_v.stdout:
    print('ALL STEPS COMPLETED SUCCESSFULLY!')
else:
    print('ERROR IN VERIFICATION!')
    exit(1)
