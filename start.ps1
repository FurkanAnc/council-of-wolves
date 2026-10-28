# Kurtlar Konseyi - Windows start script
#
#   powershell -ExecutionPolicy Bypass -File .\start.ps1
#   powershell -ExecutionPolicy Bypass -File .\start.ps1 -Reset   # forget the saved API key and connection
#
# Nothing is asked here: on first launch the browser opens a setup screen for the
# provider, API key, model and token limits. The key is saved encrypted with
# Windows DPAPI (data\api-key.dat, readable only by this Windows user on this
# computer); the rest goes to data\launch.json.

param(
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
    Write-Host "Kayitli API anahtari ve baglanti ayarlari silindi; tarayicida kurulum ekrani acilacak."
}

# Keys saved by the old launcher had no provider recorded: it always used yeta.ai + DeepSeek
if ((Test-Path $keyFile) -and -not $Reset) {
    $saved = $null
    if (Test-Path $launchFile) {
        try { $saved = Get-Content $launchFile -Raw | ConvertFrom-Json } catch { $saved = $null }
    }
    if (-not $saved -or -not ($saved.PSObject.Properties.Name -contains 'base_url')) {
        $options = [ordered]@{
            base_url = "https://platform.yeta.ai"
            model = "deepseek-v4.1-flash"
            max_tokens = if ($saved -and $saved.max_tokens) { [int]$saved.max_tokens } else { $null }
            chairman_max_tokens = if ($saved -and $saved.chairman_max_tokens) { [int]$saved.chairman_max_tokens } else { $null }
        }
        $options | ConvertTo-Json | Set-Content $launchFile
        Write-Host "Eski baglanti ayarlari tasindi (yeta.ai, deepseek-v4.1-flash)."
    }
}

if (Test-Path $keyFile) {
    Write-Host "Kayitli API anahtari kullanilacak. (Degistirmek icin: Ayarlar > Genel > Baglantiyi degistir)"
} else {
    Write-Host "Kayitli API anahtari yok: tarayicida kurulum ekrani acilacak."
}

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
    # Open the browser only once the backend answers (first start can take a while)
    Write-Host "Backend bekleniyor..."
    $ready = $false
    for ($i = 0; $i -lt 120 -and -not $ready; $i++) {
        if ($backend.HasExited) { throw "Backend baslamadi (cikis kodu $($backend.ExitCode)). Yukaridaki hata mesajina bakin." }
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:8001/" -UseBasicParsing -TimeoutSec 2 | Out-Null
            $ready = $true
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $ready) { Write-Host "UYARI: Backend 60 saniyede yanit vermedi; yine de devam ediliyor." }
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
