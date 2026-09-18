# 本地一键启动：检查环境 → 启动开发服务 → 打开浏览器
#
# 用法（任选其一）：
#   - 双击项目根目录的 启动.bat
#   - 右键本文件「使用 PowerShell 运行」
#   - 在本目录执行：powershell -ExecutionPolicy Bypass -File .\start.ps1
#
# 可传参数：-NoBrowser 只启动服务，不打开浏览器
#          -Port 5200  改用其他端口

[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [int]$Port = 5180
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# 把控制台切到 UTF-8 代码页。
# 否则子进程（vite）输出的中文会被按系统默认代码页解码成乱码，
# 让人误以为启动出错——这是实际踩到的坑，不是多余的一步。
try {
  & chcp.com 65001 > $null
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
  # 切换失败不影响启动，只是日志可能出现乱码，所以不中断
}

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Write-Warn2($text) { Write-Host "    $text" -ForegroundColor Yellow }
function Write-Bad($text) { Write-Host "    $text" -ForegroundColor Red }

Write-Host ''
Write-Host '  英语翻译练习站 · 本地开发服务' -ForegroundColor White
Write-Host '  ------------------------------------' -ForegroundColor DarkGray

# ── 1. Node 是否可用 ───────────────────────────────────────
Write-Step '检查 Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Bad '没有找到 Node.js。请先安装：https://nodejs.org/（选 LTS 版本），装完重开这个窗口。'
  Read-Host '按回车关闭'
  exit 1
}
$nodeVersion = (& node -v)
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
Write-Ok "Node $nodeVersion"
if ($major -lt 20) {
  Write-Warn2 '版本偏低，建议升级到 20 或更高。'
}

# ── 2. 依赖是否装好 ────────────────────────────────────────
Write-Step '检查依赖'
if (-not (Test-Path (Join-Path $PWD 'node_modules'))) {
  Write-Warn2 '还没有安装依赖，正在执行 npm install（第一次会比较慢）…'
  & npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) {
    Write-Bad '依赖安装失败，请把上面的报错发给我。'
    Read-Host '按回车关闭'
    exit 1
  }
}
Write-Ok '依赖已就绪'

# ── 3. 密钥文件 ────────────────────────────────────────────
# 密钥只从 .dev.vars 读取，这个文件已被 gitignore，绝不会进仓库。
$devVarsPath = Join-Path $PWD '.dev.vars'
Write-Step '检查密钥文件 .dev.vars'
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
    Write-Warn2 '没有找到 .dev.vars，正在从 .dev.vars.example 复制一份…'
    Copy-Item (Join-Path $PWD '.dev.vars.example') $devVarsPath -ErrorAction SilentlyContinue
  }
  Write-Warn2 '还没有填入 DeepSeek API 密钥。'
  Write-Warn2 "请用记事本打开：$devVarsPath"
  Write-Warn2 '把 DEEPSEEK_API_KEY= 后面补上你的密钥（形如 sk-xxxx），保存后重新双击本脚本。'
  Write-Warn2 '没有密钥也能启动：界面可以看，但提交批改会提示密钥缺失；此时可点「查看内置示例批改」。'
} else {
  $masked = if ($apiKey.Length -gt 10) { $apiKey.Substring(0, 6) + '...' + $apiKey.Substring($apiKey.Length - 4) } else { '(长度异常)' }
  Write-Ok "已读到密钥 $masked"
}

# ── 4. 端口占用 ────────────────────────────────────────────
Write-Step "检查端口 $Port"
$occupied = $null
try {
  $occupied = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
    Select-Object -First 1
} catch {
  $occupied = $null
}
if ($occupied) {
  $procId = $occupied.OwningProcess
  $procName = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
  Write-Warn2 "端口 $Port 已被占用（进程 $procName，PID $procId）。"
  Write-Warn2 '如果是上次没关干净的服务，可以先结束它：'
  Write-Warn2 "    Stop-Process -Id $procId"
  Write-Warn2 '或者换个端口启动：'
  Write-Warn2 "    .\start.ps1 -Port 5200"
  Write-Host ''
  $answer = Read-Host '现在结束那个进程并继续？(y/N)'
  if ($answer -eq 'y' -or $answer -eq 'Y') {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    Write-Ok '已结束占用端口的进程'
  } else {
    Write-Bad '已取消启动。'
    Read-Host '按回车关闭'
    exit 1
  }
} else {
  Write-Ok "端口 $Port 空闲"
}

# ── 5. 启动服务 ────────────────────────────────────────────
$url = "http://127.0.0.1:$Port/"
Write-Host ''
Write-Step "启动开发服务（$url）"
Write-Host '    服务运行期间请保持这个窗口开着；按 Ctrl+C 停止。' -ForegroundColor DarkGray
Write-Host ''

if (-not $NoBrowser) {
  # 等端口起来再开浏览器，避免打开时是错误页
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
  Write-Host '    （服务就绪后会自动打开浏览器）' -ForegroundColor DarkGray
}

try {
  & npm run dev -- --port $Port
} finally {
  if ($opener) {
    Stop-Job $opener -ErrorAction SilentlyContinue
    Remove-Job $opener -Force -ErrorAction SilentlyContinue
  }
  Write-Host ''
  Write-Host '  服务已停止。' -ForegroundColor DarkGray
}
