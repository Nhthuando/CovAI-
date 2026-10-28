$ErrorActionPreference = 'Stop'
$word = $null
$doc = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $items = @(
        @{ Input = 'D:\HuuThuan - Project\NCKH\CovAI\temp\C1SE.30_Proposal_ver1.2.docx'; Output = 'D:\HuuThuan - Project\NCKH\CovAI\scratch\proposal_reference.pdf' },
        @{ Input = 'D:\HuuThuan - Project\NCKH\CovAI\temp\C1SE.30_ProductBacklog_CovAI_ver1.1.docx'; Output = 'D:\HuuThuan - Project\NCKH\CovAI\scratch\backlog_current.pdf' }
    )
    foreach ($item in $items) {
        $doc = $word.Documents.Open($item.Input, $false, $true, $false)
        $pages = $doc.ComputeStatistics(2)
        $doc.ExportAsFixedFormat($item.Output, 17, $false, 0, 0, 0, 0, 0, $true, $true, $false, $false, $false)
        Write-Output ("{0}: {1} pages" -f $item.Input, $pages)
        $doc.Close($false)
        $doc = $null
    }
}
finally {
    if ($doc -ne $null) { $doc.Close($false) }
    if ($word -ne $null) { $word.Quit($false) }
    if ($doc -ne $null) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null }
    if ($word -ne $null) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null }
}
