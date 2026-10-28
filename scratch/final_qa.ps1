Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = 'D:\HuuThuan - Project\NCKH\CovAI'
$docxPath = Join-Path $root 'temp\C1SE.30_ProductBacklog_CovAI_ver1.1.docx'
$xlsxPath = Join-Path $root 'temp\C1SE.20_ProductBacklog-UserStory_Storelens_v1.1.xlsx'
$pdfPath = Join-Path $root 'scratch\C1SE.30_ProductBacklog_CovAI_ver1.1.rendered.pdf'
$W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
$X = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

function Read-ZipText([string]$path,[string]$name) {
  $zip=[IO.Compression.ZipFile]::OpenRead($path)
  try {
    $entry=$zip.GetEntry($name)
    if ($null -eq $entry) { throw "Missing zip entry: $name" }
    $reader=[IO.StreamReader]::new($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally { $zip.Dispose() }
}
function Assert([bool]$condition,[string]$message) { if (-not $condition) { throw "FAIL: $message" } }
function NodeText($node,$ns) {
  return (($node.SelectNodes('.//w:t',$ns) | ForEach-Object { $_.InnerText }) -join '')
}

Assert (Test-Path -LiteralPath $docxPath) 'DOCX missing'
Assert (Test-Path -LiteralPath $xlsxPath) 'XLSX missing'
Write-Output ('DOCX size: ' + (Get-Item $docxPath).Length)
Write-Output ('XLSX size: ' + (Get-Item $xlsxPath).Length)

$docXml=[xml](Read-ZipText $docxPath 'word/document.xml')
$ns=[Xml.XmlNamespaceManager]::new($docXml.NameTable); $ns.AddNamespace('w',$W)
$body=$docXml.SelectSingleNode('/w:document/w:body',$ns)
$tables=@($body.SelectNodes('./w:tbl',$ns))
$paras=@($body.SelectNodes('./w:p',$ns))
Write-Output ('DOCX direct body tables/paragraphs: ' + $tables.Count + '/' + $paras.Count)
Assert ($tables.Count -eq 12) 'DOCX must contain 12 tables'
$bodyTexts=@($paras | ForEach-Object { NodeText $_ $ns })
$titleP=@($paras | Where-Object { (NodeText $_ $ns).Trim() -eq 'Product Backlog' })
Assert ($titleP.Count -eq 1) 'plain Product Backlog cover title missing/duplicated'
$titleStyle=$titleP[0].SelectSingleNode('./w:pPr/w:pStyle',$ns)
$titleStyleVal=if ($null -eq $titleStyle) { 'Normal' } else { $titleStyle.GetAttribute('val',$W) }
Write-Output ('Cover title style: ' + $titleStyleVal)
Assert (-not $titleStyleVal.StartsWith('Heading')) 'cover title is still a heading'
$docRaw=Read-ZipText $docxPath 'word/document.xml'
$seqCount=([regex]::Matches($docRaw,'SEQ Table')).Count
$pageRefCount=([regex]::Matches($docRaw,'PAGEREF')).Count
$captionCount=([regex]::Matches($docRaw,'w:val="Caption"')).Count
$updateCount=([regex]::Matches((Read-ZipText $docxPath 'word/settings.xml'),'w:updateFields')).Count
Write-Output "Fields SEQ/PAGEREF/Caption/updateFields: $seqCount/$pageRefCount/$captionCount/$updateCount"
Assert ($seqCount -eq 12) 'must contain 12 SEQ Table fields'
Assert ($pageRefCount -eq 12) 'must contain 12 PAGEREF fields'
Assert ($captionCount -eq 12) 'must contain 12 Caption paragraphs'
Assert ($updateCount -ge 1) 'updateFields missing'
for ($ti=0;$ti -lt $tables.Count;$ti++) {
  $tbl=$tables[$ti]
  Assert ($null -ne $tbl.SelectSingleNode('./w:tblPr/w:tblBorders',$ns)) ("table $($ti+1) missing table borders")
  $cells=@($tbl.SelectNodes('./w:tr/w:tc',$ns))
  Assert ($cells.Count -gt 0) ("table $($ti+1) has no cells")
  foreach ($cell in $cells) { Assert ($null -ne $cell.SelectSingleNode('./w:tcPr/w:tcBorders',$ns)) ("table $($ti+1) has a cell without borders") }
}
$sectCount=@($body.SelectNodes('.//w:sectPr',$ns)).Count
Write-Output ('Sections: ' + $sectCount)
Assert ($sectCount -eq 6) 'section structure changed unexpectedly'
$allDocText=(($bodyTexts -join "`n") + "`n" + (($tables | ForEach-Object { NodeText $_ $ns }) -join "`n"))
foreach ($expected in @('26 Dec 2026','quylavip333@gmail.com','0334814522','thuanhuugl@gmail.com','0385591447','<=1 vCPU','<=1 GB RAM','30-second timeout')) { Assert ($allDocText.Contains($expected)) ("missing expected text: $expected") }
foreach ($forbidden in @('Hien Nguyen Thanh Long','huynhthandin h.dev@gmail.com')) { Assert (-not $allDocText.Contains($forbidden)) ("forbidden old text remains: $forbidden") }
Write-Output 'DOCX XML QA: PASS'

$ss=[xml](Read-ZipText $xlsxPath 'xl/sharedStrings.xml')
$xns=[Xml.XmlNamespaceManager]::new($ss.NameTable); $xns.AddNamespace('x',$X)
$shared=@($ss.SelectNodes('//*[local-name()="si"]') | ForEach-Object { (($_.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '') })
$sheet=[xml](Read-ZipText $xlsxPath 'xl/worksheets/sheet1.xml')
$sns=[Xml.XmlNamespaceManager]::new($sheet.NameTable); $sns.AddNamespace('x',$X)
function CellValue($cell,$shared,$sns) {
  $type=$cell.GetAttribute('t')
  if ($type -eq 's') { $v=$cell.SelectSingleNode('./*[local-name()="v"]'); if ($null -eq $v) { return '' }; return $shared[[int]$v.InnerText] }
  if ($type -eq 'inlineStr') { return (($cell.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '') }
  $v=$cell.SelectSingleNode('./*[local-name()="v"]'); if ($null -eq $v) { return '' }; return $v.InnerText
}
$rows=@()
foreach ($row in @($sheet.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]'))) {
  $rn=[int]$row.GetAttribute('r')
  if ($rn -lt 8 -or $rn -gt 40) { continue }
  $map=@{}
  foreach ($cell in @($row.SelectNodes('./*[local-name()="c"]'))) {
    $ref=$cell.GetAttribute('r'); $col=($ref -replace '\d','')
    $map[$col]=CellValue $cell $shared $sns
  }
  if ($map['B'] -like 'PB-*') { $rows += ,@($map['B'],$map['D'],$map['C'],$map['G'],$map['I'],$map['H'],$map['N'],$map['M']) }
}
Write-Output ('XLSX stories: ' + $rows.Count)
Assert ($rows.Count -eq 33) 'XLSX must contain 33 canonical stories'
for ($i=0;$i -lt 33;$i++) { Assert ($rows[$i][0] -eq ('PB-{0:D2}' -f ($i+1))) ("story id mismatch at row $i") }
$moduleCounts=@{}
foreach ($r in $rows) { if (-not $moduleCounts.ContainsKey($r[1])){$moduleCounts[$r[1]]=0};$moduleCounts[$r[1]]++ }
Write-Output ('Modules: ' + (($moduleCounts.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', '))
Assert ($moduleCounts['User'] -eq 29 -and $moduleCounts['Admin'] -eq 4 -and $moduleCounts.Count -eq 2) 'module split is not Admin 4/User 29'
$priorities=@($rows | ForEach-Object { $_[4] } | Select-Object -Unique)
Write-Output ('Priorities: ' + ($priorities -join ', '))
Assert ((@('High','Medium','Low') | Sort-Object) -join ',' -eq (($priorities | Sort-Object) -join ',')) 'priority set is not High/Medium/Low only'
$sprintTotals=@{}
foreach ($r in $rows) { $key=$r[7]; if (-not $sprintTotals.ContainsKey($key)){$sprintTotals[$key]=0}; $sprintTotals[$key]+=[double]$r[6] }
Write-Output ('Sprint hours: ' + (($sprintTotals.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', '))
$expected=@{'Sprint 1'=336;'Sprint 2'=336;'Sprint 3'=336;'Sprint 4'=144;'Sprint 5'=336;'Sprint 6'=168;'Sprint 7'=264}
foreach ($key in $expected.Keys) { Assert ($sprintTotals[$key] -eq $expected[$key]) ("sprint total mismatch $key") }
Assert (-not (($rows | ForEach-Object { $_[5] }) -match 'Mocha')) 'unsupported Mocha remains in acceptance criteria'
Write-Output 'XLSX XML QA: PASS'

$docRows=@{}
foreach ($ti in @(7,8)) {
  foreach ($tr in @($tables[$ti].SelectNodes('./w:tr',$ns) | Select-Object -Skip 1)) {
    $vals=@($tr.SelectNodes('./w:tc',$ns) | ForEach-Object { (NodeText $_ $ns).Trim() })
    if ($vals.Count -gt 0 -and $vals[0] -like 'PB-*') { $docRows[$vals[0]]=$vals }
  }
}
Assert ($docRows.Count -eq 33) ('DOCX high-level rows count is ' + $docRows.Count)
foreach ($r in $rows) {
  $dr=$docRows[$r[0]]
  Assert ($null -ne $dr) ("DOCX missing $($r[0])")
  Assert ($dr[1].StartsWith($r[2]) -and $dr[1].Contains("[$($r[7]) | $($r[6])h]")) ("theme/sprint/estimate mismatch $($r[0])")
  Assert ($dr[2] -eq $r[1]) ("module mismatch $($r[0])")
  Assert ($dr[5] -eq $r[4]) ("priority mismatch $($r[0])")
}
Write-Output 'Cross-artifact story QA: PASS'
Assert (Test-Path -LiteralPath $pdfPath) 'rendered PDF missing'
Write-Output ('Rendered PDF size: ' + (Get-Item $pdfPath).Length)
Write-Output 'FINAL CONTENT/STRUCTURE QA: PASS'
