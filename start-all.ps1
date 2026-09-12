# ============================================================
#  KANBAN - Start All Services
# ============================================================
#  Starts three services in separate terminal windows:
#    1. Backend API      (kanban-backend/index.js    - port 4000)
#    2. WebSocket Server (kanban-backend/wsServer.js)
#    3. Frontend Dev     (kanban-frontend - Vite)
# ============================================================

$root = $PSScriptRoot

function Start-Service {
    param(
        [string]$Title,
        [string]$WorkDir,
        [string]$Command
    )
    Start-Process powershell -ArgumentList `
        "-NoExit", "-Command", `
        "`$host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkDir'; $Command"
}

Write-Host ""
Write-Host "  Starting KANBAN services..." -ForegroundColor Cyan
Write-Host ""

# 1. Backend API
Start-Service `
    -Title  "KANBAN - Backend API (port 4000)" `
    -WorkDir "$root\kanban-backend" `
    -Command "npm run dev"

Write-Host "  [1/3] Backend API       -> npm run dev  (kanban-backend)" -ForegroundColor Green

# 2. WebSocket Server
Start-Service `
    -Title  "KANBAN - WebSocket Server" `
    -WorkDir "$root\kanban-backend" `
    -Command "npm run dev:ws"

Write-Host "  [2/3] WebSocket Server  -> npm run dev:ws  (kanban-backend)" -ForegroundColor Green

# 3. Frontend (Vite)
Start-Service `
    -Title  "KANBAN - Frontend (Vite)" `
    -WorkDir "$root\kanban-frontend" `
    -Command "npm run dev"

Write-Host "  [3/3] Frontend          -> npm run dev  (kanban-frontend)" -ForegroundColor Green

Write-Host ""
Write-Host "  All services launched in separate windows." -ForegroundColor Cyan
Write-Host "  Close those windows (or press Ctrl+C inside them) to stop each service." -ForegroundColor DarkGray
Write-Host ""
