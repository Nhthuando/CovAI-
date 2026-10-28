param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

$word = $null
$document = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $document = $word.Documents.Open($InputPath, $false, $true)
    $document.Fields.Update() | Out-Null
    $document.ExportAsFixedFormat($OutputPath, 17)
}
finally {
    if ($document -ne $null) { $document.Close($false) }
    if ($word -ne $null) { $word.Quit() }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}

