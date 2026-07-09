$ErrorActionPreference = "Stop"

$xlsxPath = "C:\Users\Lauren.Dwyer\OneDrive - Big Red Book\Red Edu\webinar_video_routing_index.xlsx"
$endpoint = "https://brc-live-mcp-app-staging.azurewebsites.net/internal/brc-edu/resources/sync"
$secret = [Environment]::GetEnvironmentVariable("BRC_EDU_STAGING_SYNC_SECRET", "User")

if ([string]::IsNullOrWhiteSpace($secret)) {
    throw "BRC_EDU_STAGING_SYNC_SECRET is not set in user environment variables."
}

if (!(Test-Path $xlsxPath)) {
    throw "XLSX file not found: $xlsxPath"
}

$tempCsvPath = Join-Path $env:TEMP "brc_edu_webinar_video_routing_index.csv"

$excel = $null
$workbook = $null

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false

    $workbook = $excel.Workbooks.Open($xlsxPath)

    # 6 = xlCSV
    $workbook.SaveAs($tempCsvPath, 6)

    $workbook.Close($false)
    $excel.Quit()
}
finally {
    if ($workbook -ne $null) {
        try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null } catch {}
    }

    if ($excel -ne $null) {
        try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null } catch {}
    }

    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

$csvText = [System.IO.File]::ReadAllText($tempCsvPath)

if ([string]::IsNullOrWhiteSpace($csvText)) {
    throw "Converted CSV is empty: $tempCsvPath"
}

$body = @{
    csvText = $csvText
} | ConvertTo-Json -Compress

$response = Invoke-RestMethod `
    -Method Post `
    -Uri $endpoint `
    -Headers @{ "x-red-edu-sync-secret" = $secret } `
    -ContentType "application/json; charset=utf-8" `
    -Body $body

$logDir = Join-Path $PSScriptRoot "..\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$logLine = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') synced from XLSX rowsRead=$($response.rowsRead) rowsEnriched=$($response.rowsEnriched) storedAt=$($response.storedAt)"
Add-Content -Path (Join-Path $logDir "brc_edu_sync_staging.log") -Value $logLine

$response