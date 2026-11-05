import json, pathlib, zipfile, xml.etree.ElementTree as ET
from PIL import Image

root=pathlib.Path(__file__).parent
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
summary=json.loads((root/'summary.json').read_text())
all_ids=set()
checks=[]
for sp in summary:
    file=root/sp['filename']
    with zipfile.ZipFile(file) as z:
        assert z.testzip() is None
        strings=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            strings=[''.join(n.text or '' for n in e.iter('{'+ns['s']+'}t')) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rels={e.attrib['Id']:e.attrib['Target'] for e in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        sheets=ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets',ns)
        assert len(sheets)==sp['modules']+1
        count=0
        for i,sheet in enumerate(sheets):
            target=rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
            xml=ET.fromstring(z.read(target))
            values={}
            formulas={}
            for c in xml.findall('s:sheetData/s:row/s:c',ns):
                v=c.find('s:v',ns)
                val=v.text if v is not None else ''
                if c.attrib.get('t')=='s': val=strings[int(val)] if val else ''
                if c.attrib.get('t')=='inlineStr': val=''.join(n.text or '' for n in c.findall('.//s:t',ns))
                if c.attrib.get('t')=='e': raise AssertionError(f'Formula error in {sheet.attrib["name"]}!{c.attrib["r"]}: {val}')
                values[c.attrib['r']]=val
                f=c.find('s:f',ns)
                if f is not None: formulas[c.attrib['r']]=f.text
            text='\n'.join(values.values())
            for forbidden in ['StoreLens','storelens','C1SE.20','YOLOv8','RTSP','POS Data Integration','Heatmap Analysis','Vo Thi Tuong Vy','Truong Thanh Dat']:
                assert forbidden not in text,(sheet.attrib['name'],forbidden)
            if i<sp['modules']:
                m=sp['moduleDetails'][i]
                assert sheet.attrib['name']==m['name']
                status=m['status']; actual=chr(ord(status)-1)
                for row in range(12,m['last']+1):
                    id=values[f'A{row}']; assert id not in all_ids; all_ids.add(id)
                    assert values[f'{status}{row}']=='Not Run'
                    assert not values.get(f'{actual}{row}')
                    for col in ('B','C','D','E','F'):
                        assert values.get(f'{col}{row}'),(sheet.attrib['name'],row,col)
                    count+=1
                assert formulas['B9']==f'COUNTA(A12:A{m["last"]})'
                dv=xml.find('s:dataValidations',ns)
                assert dv is not None and any(f'{status}12:{status}{m["last"]}' in e.attrib['sqref'] for e in dv)
                assert xml.find('s:sheetViews/s:sheetView/s:pane',ns) is not None
                # Actual results, reviewer and evaluation date remain genuinely blank.
                assert not values.get('B5') and not values.get('B6')
            else:
                assert sheet.attrib['name']==f'Sprint {sp["sprint"]} Test Report'
                assert float(values[f'C{sp["totalRow"]}'])==sp['cases']
                assert float(values[f'D{sp["totalRow"]}'])==0
                assert float(values[f'E{sp["totalRow"]}'])==0
                assert float(values['H11'])==sp['cases']
                assert float(values['H12'])==0
                assert not values.get('C4')
        assert count==sp['cases']
        charts=[name for name in z.namelist() if '/charts/' in name and name.endswith('.xml')]
        assert len(charts)==1,charts
        chart=z.read(charts[0]).decode()
        assert 'pieChart' in chart
        assert '$G$9:$G$12' in chart or 'G9:G12' in chart
        assert '$H$9:$H$12' in chart or 'H9:H12' in chart
        checks.append({'file':file.name,'cases':count,'modules':sp['modules'],'tasks':sp['tasks'],'chart':charts[0],'status':'all Not Run; no cached errors'})

paths=sorted(root.glob('preview-*.png'))
for groupno,start in enumerate(range(0,len(paths),4)):
    images=[Image.open(p).convert('RGB') for p in paths[start:start+4]]
    canvas=Image.new('RGB',(max(im.width for im in images),sum(im.height for im in images)),'white')
    y=0
    for im in images: canvas.paste(im,(0,y)); y+=im.height
    canvas.save(root/f'contact-{groupno}.png')
(root/'verification.json').write_text(json.dumps(checks,indent=2))
print(json.dumps(checks,indent=2))
print('Unique test case IDs:',len(all_ids))
