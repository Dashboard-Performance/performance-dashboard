# v1.17.0 - PowerShell version of deploy/upgrade-v1.17.sh
# Run:  powershell -ExecutionPolicy Bypass -File .\deploy\upgrade-v1.17.ps1
# 'Continue': wrangler writes progress to stderr, which PowerShell 5.1 would turn into a fatal error with 'Stop'. Failures are checked with $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
function Say($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
Push-Location cloudflare-worker
npx --yes wrangler whoami *> $null
if ($LASTEXITCODE -ne 0) { npx --yes wrangler login; if ($LASTEXITCODE -ne 0) { throw "Cloudflare login failed." } }

Say "Step 1 of 3 - D1 database for the Command Loop tasks"
$tomlPath = Join-Path (Get-Location).Path 'wrangler.toml'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$toml = [IO.File]::ReadAllText($tomlPath, $utf8)
if ($toml -match 'PASTE-THE-D1-DATABASE-ID-HERE') {
    $out = (npx --yes wrangler d1 create taager-command-loop 2>&1 | Out-String)
    $m = [regex]::Match($out, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
    if (-not $m.Success) {
        $list = (npx --yes wrangler d1 list --json | Out-String) | ConvertFrom-Json
        $db = $list | Where-Object { $_.name -eq 'taager-command-loop' } | Select-Object -First 1
        if (-not $db) { Write-Host $out; throw "Could not read the D1 id." }
        $id = if ($db.uuid) { $db.uuid } else { $db.database_id }
    } else { $id = $m.Value }
    [IO.File]::WriteAllText($tomlPath, ($toml -replace 'PASTE-THE-D1-DATABASE-ID-HERE', $id), $utf8)
    Write-Host "  OK D1 database $id"
} else { Write-Host "  OK D1 id already in wrangler.toml" }

Say "Step 2 of 3 - dashboard Worker"
npx --yes wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "Dashboard Worker deploy failed." }
Pop-Location

Say "Step 3 of 3 - merchant portal Worker"
Push-Location merchant-portal; npx --yes wrangler deploy; $code = $LASTEXITCODE; Pop-Location
if ($code -ne 0) { throw "Merchant portal deploy failed." }

Say "Done"
Write-Host "Upload the website files (v1.17.0). Then Control -> Command Loop -> Engine -> Run now."
Write-Host "Users & Roles: set 'Linked ACM account' for every Account Manager."
Write-Host "Merchant portal /admin -> Refresh -> 'Notifications (Command Loop)' once."
