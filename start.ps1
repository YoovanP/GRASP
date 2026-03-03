# start.ps1 — boot both FastAPI backend and Next.js frontend in parallel
# Run from the repo root: .\start.ps1

$repoRoot = $PSScriptRoot

# ── 1. Check .env files exist ─────────────────────────────────────────────────
$backendEnv  = Join-Path $repoRoot "backend\.env"
$frontendEnv = Join-Path $repoRoot "frontend\.env.local"

if (-not (Test-Path $backendEnv)) {
    Write-Host ""
    Write-Host "ERROR: backend\.env not found." -ForegroundColor Red
    Write-Host "  Copy backend\.env.example → backend\.env and fill in your values." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

if (-not (Test-Path $frontendEnv)) {
    Write-Host ""
    Write-Host "ERROR: frontend\.env.local not found." -ForegroundColor Red
    Write-Host "  Copy frontend\.env.local.example → frontend\.env.local and fill in your API_KEY." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# ── 1.5 Free common local dev ports if occupied ───────────────────────────────
foreach ($port in @(8000, 3000)) {
    $pids = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
        if ($pid -gt 0) {
            try {
                Stop-Process -Id $pid -Force -ErrorAction Stop
                Write-Host "Freed port $port (stopped PID $pid)." -ForegroundColor DarkYellow
            } catch {
                Write-Host "Could not stop PID $pid on port $port." -ForegroundColor Yellow
            }
        }
    }
}

# ── 2. Start FastAPI (uvicorn) in a new PowerShell window ────────────────────
Write-Host "Starting FastAPI backend on http://localhost:8000 ..." -ForegroundColor Cyan
$backendCmd = "cd '$repoRoot'; python -m uvicorn backend.api:app --reload --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd

# Give uvicorn a moment to boot before starting Next.js
Start-Sleep -Seconds 3

# ── 3. Start Next.js dev server ───────────────────────────────────────────────
Write-Host "Starting Next.js frontend on http://localhost:3000 ..." -ForegroundColor Cyan
$frontendDir = Join-Path $repoRoot "frontend"
$frontendCmd = "cd '$frontendDir'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd

Write-Host ""
Write-Host "Both processes started." -ForegroundColor Green
Write-Host "  Backend : http://localhost:8000/docs  (Swagger UI)" -ForegroundColor White
Write-Host "  Frontend: http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "Press any key to exit this launcher (processes keep running)..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
