# Claude Council - Windows start script
#
#   powershell -ExecutionPolicy Bypass -File .\start.ps1
#   powershell -ExecutionPolicy Bypass -File .\start.ps1 -Model deepseek-v4.1-flash
#   powershell -ExecutionPolicy Bypass -File .\start.ps1 -MaxTokens 4096 -ChairmanMaxTokens 8192
#   powershell -ExecutionPolicy Bypass -File .\start.ps1 -Anthropic   # use the Anthropic API key from .env
#   powershell -ExecutionPolicy Bypass -File .\start.ps1 -Reset       # forget the saved key and token limits
#
# The API key is saved encrypted with Windows DPAPI (data\api-key.dat): only this
# Windows user on this computer can decrypt it. Token limits go to data\launch.json.

param(
    [string]$BaseUrl = "https://platform.yeta.ai",
    [string]$Model = "deepseek-v4.1-flash",
    [int]$MaxTokens = 0,          # stages 1-2; saved value or asked when not given
    [int]$ChairmanMaxTokens = 0,  # stage 3; same as MaxTokens when not given
    [switch]$Anthropic,
    [switch]$Reset
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$dataDir = Join-Path $PSScriptRoot "data"
$keyFile = Join-Path $dataDir "api-key.dat"
$launchFile = Join-Path $dataDir "launch.json"
New-Item -ItemType Directory -Force $dataDir | Out-Null

Write-Host "Kurtlar Konseyi baslatiliyor..."

if ($Reset) {
    Remove-Item $keyFile, $launchFile -ErrorAction SilentlyContinue
    Write-Host "Kayitli API anahtari ve token ayarlari silindi."
}

if (-not $Anthropic) {
    $token = $null
    if (Test-Path $keyFile) {
        try {
            $secure = (Get-Content $keyFile -Raw).Trim() | ConvertTo-SecureString
            $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
            Write-Host "Kayitli API anahtari kullaniliyor. (Degistirmek icin: Anahtari Sifirla.bat)"
        } catch {
            Write-Host "Kayitli anahtar okunamadi, yeniden girin."
            $token = $null
        }
    }
    while (-not $token) {
        $secure = Read-Host 'API key' -AsSecureString
        $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
        if ($token) {
            # Encrypted for this Windows user only
            ConvertTo-SecureString $token -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $keyFile
            Write-Host "API anahtari sifreli olarak kaydedildi; bir dahaki sefere sorulmayacak."
        }
    }
    $env:ANTHROPIC_AUTH_TOKEN = $token
    # A leftover Anthropic key would be sent instead of the provider token
    Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
    $env:ANTHROPIC_BASE_URL = $BaseUrl
    $env:ANTHROPIC_MODEL = $Model
    Write-Host "Saglayici: $BaseUrl  Model: $Model"
}

# Saved token limits, unless given on the command line
$saved = $null
if (Test-Path $launchFile) {
    try { $saved = Get-Content $launchFile -Raw | ConvertFrom-Json } catch { $saved = $null }
}
if ($MaxTokens -le 0 -and $saved -and $saved.max_tokens -gt 0) { $MaxTokens = [int]$saved.max_tokens }
if ($ChairmanMaxTokens -le 0 -and $saved -and $saved.chairman_max_tokens -gt 0) { $ChairmanMaxTokens = [int]$saved.chairman_max_tokens }

# The Messages API requires max_tokens on every request, so it must be a number
while ($MaxTokens -le 0) {
    $answer = Read-Host 'Max tokens (asama 1-2)'
    [void][int]::TryParse($answer, [ref]$MaxTokens)
}
if ($ChairmanMaxTokens -le 0) {
    $answer = Read-Host "Baskan icin max tokens (bos birakilirsa $MaxTokens)"
    if (-not [int]::TryParse($answer, [ref]$ChairmanMaxTokens) -or $ChairmanMaxTokens -le 0) {
        $ChairmanMaxTokens = $MaxTokens
    }
}
@{ max_tokens = $MaxTokens; chairman_max_tokens = $ChairmanMaxTokens } | ConvertTo-Json | Set-Content $launchFile
$env:MAX_TOKENS = "$MaxTokens"
$env:CHAIRMAN_MAX_TOKENS = "$ChairmanMaxTokens"
Write-Host "Max tokens: $MaxTokens  Baskan: $ChairmanMaxTokens"

# Install dependencies on first run
if (-not (Test-Path ".venv")) {
    Write-Host "Python bagimliliklari kuruluyor..."
    uv sync
}
if (-not (Test-Path "frontend\node_modules")) {
    Write-Host "Frontend bagimliliklari kuruluyor..."
    Push-Location frontend
    npm.cmd install
    Pop-Location
}

Write-Host "Backend:  http://localhost:8001"
$backend = Start-Process -FilePath "uv" -ArgumentList "run", "python", "-m", "backend.main" -NoNewWindow -PassThru

try {
    Start-Sleep -Seconds 2
    Write-Host "Frontend: http://localhost:5173  (durdurmak icin Ctrl+C)"
    Push-Location frontend
    # --open launches the browser once the dev server is ready
    npm.cmd run dev -- --open
}
finally {
    Pop-Location
    if ($backend -and -not $backend.HasExited) {
        Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
        # uv starts python as a child process; stop whatever still holds the port
        Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
}
