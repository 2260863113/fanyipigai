# Local one-click launcher: check the environment, start the dev server, open the browser.
#
# THIS FILE IS INTENTIONALLY ASCII-ONLY. DO NOT ADD NON-ASCII CHARACTERS.
#   Windows PowerShell 5.1 reads a BOM-less file as ANSI (GBK on Chinese Windows),
#   which corrupts non-ASCII string literals and makes the script fail to parse.
#   Depending on a UTF-8 BOM to fix that is fragile: one editor save or tool
#   round-trip can drop the BOM and the script dies with a confusing parse error.
#   Keeping the source ASCII removes the whole class of problems.
#   The Chinese user interface lives in the web app, not here.
#
# Usage:
#   - double-click the launcher .bat in the project root
#   - or run: powershell -ExecutionPolicy Bypass -File .\start.ps1
#
# Parameters:
#   -NoBrowser   start the server only, do not open a browser
#   -Port 5200   use another port
#   -Diagnose    run the environment checks and exit (does not start the server)

[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [int]$Port = 5180,
  [switch]$Diagnose
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# Switch the console to UTF-8 so the child process (vite) does not print mojibake.
try {
  & chcp.com 65001 > $null
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
  # Not fatal: only log output would look garbled.
}

$Step = '==> '
$Indent = '    '

function Say([string]$text, [string]$color = 'Gray') {
  Write-Host ($Indent + $text) -ForegroundColor $color
}

Write-Host ''
Write-Host '  Fanyipigai - local dev server' -ForegroundColor White
Write-Host '  ---------------------------------------' -ForegroundColor DarkGray

# -- 1. Node ----------------------------------------------------------
Write-Host ($Step + 'Check Node.js') -ForegroundColor Cyan
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Say 'Node.js not found. Install the LTS build from https://nodejs.org/ then reopen this window.' 'Red'
  Read-Host 'Press Enter to close'
  exit 1
}
$nodeVersion = (& node -v)
$major = 0
[void][int]::TryParse($nodeVersion.TrimStart('v').Split('.')[0], [ref]$major)
Say "Node $nodeVersion" 'Green'
if ($major -lt 20) { Say 'Version looks old; 20 or newer is recommended.' 'Yellow' }

# -- 2. Dependencies --------------------------------------------------
Write-Host ($Step + 'Check dependencies') -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $PWD 'node_modules'))) {
  Say 'node_modules is missing, running npm install (the first run takes a while)...' 'Yellow'
  & npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) {
    Say 'npm install failed. Copy the messages above and send them to the developer.' 'Red'
    Read-Host 'Press Enter to close'
    exit 1
  }
}
Say 'dependencies ready' 'Green'

# -- 3. API key (.dev.vars is gitignored and never committed) ---------
$devVarsPath = Join-Path $PWD '.dev.vars'
Write-Host ($Step + 'Check .dev.vars') -ForegroundColor Cyan
$apiKey = ''
if (Test-Path $devVarsPath) {
  foreach ($line in Get-Content -LiteralPath $devVarsPath) {
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith('DEEPSEEK_API_KEY=')) {
      $apiKey = $trimmed.Substring('DEEPSEEK_API_KEY='.Length).Trim().Trim('"').Trim("'")
    }
  }
}
if (-not $apiKey) {
  if (-not (Test-Path $devVarsPath)) {
    Say '.dev.vars not found, copying it from .dev.vars.example' 'Yellow'
    Copy-Item (Join-Path $PWD '.dev.vars.example') $devVarsPath -ErrorAction SilentlyContinue
  }
  Say 'No DeepSeek API key yet. Open this file in Notepad:' 'Yellow'
  Say $devVarsPath 'Yellow'
  Say 'Fill in DEEPSEEK_API_KEY= with your key (looks like sk-xxxx), save, then run the launcher again.' 'Yellow'
  Say 'The site still opens without a key, but grading will report the missing key.' 'Yellow'
  Say 'In that case use the built-in sample grading to see how annotations look.' 'Yellow'
} else {
  $masked = if ($apiKey.Length -gt 10) { $apiKey.Substring(0, 6) + '...' + $apiKey.Substring($apiKey.Length - 4) } else { '(unexpected length)' }
  Say ('API key loaded: ' + $masked) 'Green'
}

# -- 4. Port ----------------------------------------------------------
Write-Host ($Step + "Check port $Port") -ForegroundColor Cyan
$occupied = $null
try {
  $occupied = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
} catch {
  $occupied = $null
}
if ($occupied) {
  $ownerId = $occupied.OwningProcess
  $ownerName = (Get-Process -Id $ownerId -ErrorAction SilentlyContinue).ProcessName
  Say ("port $Port is already in use by $ownerName (PID $ownerId).") 'Yellow'
  Say ("If it is a leftover server, stop it with:  Stop-Process -Id $ownerId") 'Yellow'
  Say 'Or start on another port:  .\start.ps1 -Port 5200' 'Yellow'
  Write-Host ''
  $answer = Read-Host 'Stop that process and continue? (y/N)'
  if ($answer -eq 'y' -or $answer -eq 'Y') {
    Stop-Process -Id $ownerId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    Say 'stopped the process holding the port' 'Green'
  } else {
    Say 'cancelled' 'Red'
    Read-Host 'Press Enter to close'
    exit 1
  }
} else {
  Say 'port is free' 'Green'
}

# -- 5. Start ---------------------------------------------------------
$url = "http://127.0.0.1:$Port/"
Write-Host ''
Write-Host ($Step + "Start dev server ($url)") -ForegroundColor Cyan

if ($Diagnose) {
  Write-Host ''
  Write-Host '  Diagnose mode: checks passed, server not started.' -ForegroundColor Cyan
  Write-Host '  No errors above means the launcher itself is fine.' -ForegroundColor DarkGray
  Write-Host ''
  exit 0
}

Say 'Keep this window open while the server runs; press Ctrl+C to stop.' 'DarkGray'
Write-Host ''

$opener = $null
if (-not $NoBrowser) {
  # Wait until the port answers, then open the browser, so it never lands on an error page.
  $opener = Start-Job -ScriptBlock {
    param($target, $timeoutSeconds)
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
      try {
        $response = Invoke-WebRequest -Uri $target -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
          Start-Process $target
          return
        }
      } catch {
        Start-Sleep -Milliseconds 400
      }
    }
  } -ArgumentList $url, 40
  Say '(the browser opens automatically once the server is ready)' 'DarkGray'
}

try {
  & npm run dev -- --port $Port
} finally {
  if ($opener) {
    Stop-Job $opener -ErrorAction SilentlyContinue
    Remove-Job $opener -Force -ErrorAction SilentlyContinue
  }
  Write-Host ''
  Write-Host '  Server stopped.' -ForegroundColor DarkGray
}
