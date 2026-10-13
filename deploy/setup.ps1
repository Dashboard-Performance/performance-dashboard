# v1.16.0 - PowerShell version of deploy/setup.sh (same steps, same order).
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File .\deploy\setup.ps1
# Needs: Node.js 18+ and a Cloudflare login (the script runs `wrangler login` if needed).
# Secrets are generated here, never printed, except the 3 values you must paste into Apps Script
# and the merchant-portal admin key at the end.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$Root = (Get-Location).Path

function Say($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }

function New-Rand([int]$n) {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.ToCharArray()
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $sb = New-Object System.Text.StringBuilder
    $buf = New-Object byte[] 1
    while ($sb.Length -lt $n) {
        $rng.GetBytes($buf)
        if ($buf[0] -lt 248) { [void]$sb.Append($chars[$buf[0] % 62]) }
    }
    $sb.ToString()
}

function Read-Secret([string]$prompt) {
    $s = Read-Host $prompt -AsSecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# Sets several secrets at once with `wrangler secret bulk` (avoids the trailing-newline problem
# of piping into a native command on Windows). The temp file is deleted right away.
function Set-Secrets([string]$dir, [hashtable]$values) {
    $tmp = Join-Path $env:TEMP ("wsec_" + (New-Rand 12) + ".json")
    $json = $values | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding $false))
    Push-Location $dir
    try {
        & npx.cmd --yes wrangler secret bulk $tmp
        if ($LASTEXITCODE -ne 0) { throw "wrangler secret bulk failed in $dir" }
        foreach ($k in $values.Keys) { Write-Host "  OK $k" -ForegroundColor Green }
    }
    finally {
        Pop-Location
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-Deploy([string]$dir) {
    Push-Location $dir
    try {
        & npx.cmd --yes wrangler deploy
        if ($LASTEXITCODE -ne 0) { throw "wrangler deploy failed in $dir" }
    }
    finally { Pop-Location }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required (https://nodejs.org)" }

Say "Cloudflare login"
Push-Location cloudflare-worker
cmd /c "npx.cmd --yes wrangler whoami >nul 2>&1"
$loggedIn = ($LASTEXITCODE -eq 0)
if (-not $loggedIn) {
    & npx.cmd --yes wrangler login
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare login failed" }
}
Pop-Location

$STAFF_SESSION_SECRET = New-Rand 48
$SERVICE_KEY = New-Rand 32
$APPS_SCRIPT_SERVICE_KEY = New-Rand 32
$PORTAL_ADMIN_KEY = New-Rand 24
$PORTAL_SESSION_SECRET = New-Rand 48

Say "Step 1 of 4 - the current ADMIN_KEY of the dashboard Worker"
Write-Host "Paste the ADMIN_KEY you use in the dashboard (Users & Roles -> Admin key). Leave empty to create a new one."
$DASH_ADMIN_KEY = Read-Secret "ADMIN_KEY"
$NEW_ADMIN = $false
if ([string]::IsNullOrEmpty($DASH_ADMIN_KEY)) { $DASH_ADMIN_KEY = New-Rand 32; $NEW_ADMIN = $true }

Say "Step 2 of 4 - Apps Script (do this now, in the browser)"
Write-Host @"
Open the Apps Script project -> paste backend/Code.gs -> Project Settings -> Script Properties, add:

  API_KEYS            = $DASH_ADMIN_KEY
  SERVICE_KEY         = $APPS_SCRIPT_SERVICE_KEY
  WORKER_SERVICE_KEY  = $SERVICE_KEY

Then: Deploy -> Manage deployments -> Edit (pencil) -> Version: New version -> Deploy.
"@
if ($NEW_ADMIN) { Write-Host "(New ADMIN_KEY - save it in your password manager; you type it once per browser in Users & Roles.)" -ForegroundColor Yellow }
[void](Read-Host "Press Enter when Apps Script is deployed")

Say "Step 3 of 4 - dashboard Worker secrets + deploy"
$dash = @{
    SERVICE_KEY             = $SERVICE_KEY
    APPS_SCRIPT_SERVICE_KEY = $APPS_SCRIPT_SERVICE_KEY
    STAFF_SESSION_SECRET    = $STAFF_SESSION_SECRET
}
if ($NEW_ADMIN) { $dash['ADMIN_KEY'] = $DASH_ADMIN_KEY }
Set-Secrets (Join-Path $Root 'cloudflare-worker') $dash
Invoke-Deploy (Join-Path $Root 'cloudflare-worker')
Write-Host "Now upload the website files (v1.16.0) the way you always do. Everyone signs in once again."
[void](Read-Host "Press Enter when the website is uploaded")

Say "Step 4 of 4 - merchant portal (new Worker)"
$portal = Join-Path $Root 'merchant-portal'
Set-Location $portal
$tomlPath = Join-Path $portal 'wrangler.toml'
$toml = [IO.File]::ReadAllText($tomlPath)
if ($toml -match 'PASTE_THE_KV_NAMESPACE_ID_HERE') {
    $out = (cmd /c "npx.cmd --yes wrangler kv namespace create PORTAL_KV 2>&1") | Out-String
    $m = [regex]::Match($out, '[0-9a-f]{32}')
    if (-not $m.Success) { Write-Host "Could not read the KV id from:"; Write-Host $out; throw "KV namespace creation failed" }
    $toml = $toml.Replace('PASTE_THE_KV_NAMESPACE_ID_HERE', $m.Value)
    [IO.File]::WriteAllText($tomlPath, $toml, (New-Object Text.UTF8Encoding $false))
    Write-Host "  OK KV namespace $($m.Value)" -ForegroundColor Green
}
$defaultMQ = 'https://metabase.taager.com/public/question/5761d362-9da0-4f6a-9c83-2d569d8c5f38'
$MQ = Read-Host "Merchant query link [$defaultMQ]"
if ([string]::IsNullOrWhiteSpace($MQ)) { $MQ = $defaultMQ }
$ps = @{
    ADMIN_KEY             = $PORTAL_ADMIN_KEY
    SESSION_SECRET        = $PORTAL_SESSION_SECRET
    MERCHANT_QUERY_URL    = $MQ
    DASHBOARD_SERVICE_KEY = $SERVICE_KEY
}
$RK = Read-Secret "Resend API key for emails (optional, Enter to skip)"
if (-not [string]::IsNullOrEmpty($RK)) {
    $ps['RESEND_API_KEY'] = $RK
    Write-Host "  -> also set MAIL_FROM and PORTAL_URL in merchant-portal/wrangler.toml, then redeploy"
}
Set-Secrets $portal $ps
Invoke-Deploy $portal

Say "Done"
Write-Host @"
Merchant portal admin key (opens https://<portal>/admin):  $PORTAL_ADMIN_KEY
Save it in your password manager - it is not stored anywhere else.

Next, in the browser:
  1) https://<portal>/admin -> Refresh now -> "Check the column mapping" -> Import merchants from the dashboard.
  2) Put the portal address in js/tower.js -> MERCHANT_PORTAL_URL, upload the website again.
"@
