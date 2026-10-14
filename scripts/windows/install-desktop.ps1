#Requires -Version 5.1
<#
.SYNOPSIS
    Installs the omp-web Desktop application (Rust / Tauri v2) and creates Desktop / Start Menu shortcuts.
.PARAMETER TargetDir
    Installation directory. Defaults to $env:LOCALAPPDATA\Programs\ompweb-desktop
.PARAMETER Launch
    Launch the desktop application immediately after installation.
#>

param(
    [string]$TargetDir = "",
    [switch]$Autostart,
    [switch]$KeepWebTray,
    [switch]$Launch,
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$SourceExe = Join-Path $RepoRoot "src-tauri\target\release\ompweb-desktop.exe"
$SourceIco = Join-Path $RepoRoot "src-tauri\icons\tray-desktop.ico"

# Ensure cargo is accessible from ~/.cargo/bin if not in PATH
if (!(Get-Command cargo -ErrorAction SilentlyContinue)) {
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if (Test-Path (Join-Path $cargoBin "cargo.exe")) {
        $env:PATH = "$cargoBin;$env:PATH"
    }
}

# Stop anything still running before building/overwriting: Windows locks a running
# executable, and a backend orphaned by a forced kill would keep serving the
# previous build on its port.
$desktopProcs = Get-Process -Name "ompweb-desktop" -ErrorAction SilentlyContinue
if ($desktopProcs) {
    Write-Host "  Stopping running omp-web Desktop instance(s)..." -ForegroundColor Cyan
    $desktopProcs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 900
}
foreach ($port in 30177, 30178) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
        if ($owner -and $owner.Name -like "node*") {
            Write-Host "  Stopping orphaned backend on port $port (PID $($owner.ProcessId))..." -ForegroundColor Cyan
            Start-Process -FilePath (Join-Path $env:SystemRoot "System32\taskkill.exe") -ArgumentList "/PID $($owner.ProcessId) /T /F" -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
        }
    }
}

if ($Rebuild -or !(Test-Path $SourceExe)) {
    if ($Rebuild) {
        Write-Host "Rebuilding omp-web Desktop application (--release --features custom-protocol)..." -ForegroundColor Cyan
    } else {
        Write-Host "[!] Release executable not found at: $SourceExe" -ForegroundColor Yellow
        Write-Host "    Attempting to build desktop binary first..." -ForegroundColor Cyan
    }
    # --features custom-protocol is mandatory: without it tauri/build.rs sets cfg(dev),
    # the executable stops embedding frontendDist and its window opens devUrl
    # (http://127.0.0.1:30178) instead of the embedded start screen.
    & cargo build --release --features custom-protocol --manifest-path (Join-Path $RepoRoot "src-tauri\Cargo.toml")
    if ($LASTEXITCODE -ne 0 -or !(Test-Path $SourceExe)) {
        Write-Error "Failed to build ompweb-desktop.exe"
        exit 1
    }
}

if ([string]::IsNullOrWhiteSpace($TargetDir)) {
    $TargetDir = Join-Path $env:LOCALAPPDATA "Programs\ompweb-desktop"
}

Write-Host "Installing omp-web Desktop application..." -ForegroundColor Green
Write-Host "  Source: $SourceExe"
Write-Host "  Target Directory: $TargetDir"

if (!(Test-Path $TargetDir)) {
    New-Item -Path $TargetDir -ItemType Directory -Force | Out-Null
}

# Copy binary and icons
$InstalledExe = Join-Path $TargetDir "ompweb-desktop.exe"
$InstalledIco = Join-Path $TargetDir "tray-desktop.ico"

$copied = $false
for ($attempt = 1; $attempt -le 5 -and !$copied; $attempt++) {
    try {
        Copy-Item -Path $SourceExe -Destination $InstalledExe -Force -ErrorAction Stop
        $copied = $true
    } catch {
        if ($attempt -eq 5) { throw }
        Start-Sleep -Milliseconds 600
    }
}
if (Test-Path $SourceIco) {
    Copy-Item -Path $SourceIco -Destination $InstalledIco -Force
}

Write-Host "  [OK] Binary installed to: $InstalledExe" -ForegroundColor Green

# Create Shortcuts
$wsh = New-Object -ComObject WScript.Shell

# 1. Desktop Shortcut
$desktopDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$desktopLnk = Join-Path $desktopDir "omp-web Desktop.lnk"
try {
    $sc = $wsh.CreateShortcut($desktopLnk)
    $sc.TargetPath = $InstalledExe
    $sc.WorkingDirectory = $RepoRoot
    if (Test-Path $InstalledIco) {
        $sc.IconLocation = "$InstalledIco,0"
    } else {
        $sc.IconLocation = "$InstalledExe,0"
    }
    $sc.Description = "omp-web Desktop Coding Agent (GUI)"
    $sc.Save()
    Write-Host "  [OK] Desktop shortcut created: $desktopLnk" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] Failed to create Desktop shortcut: $_" -ForegroundColor Yellow
}

# 2. Start Menu Shortcut
$startMenuDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Programs)
$startMenuLnk = Join-Path $startMenuDir "omp-web Desktop.lnk"
try {
    $sc2 = $wsh.CreateShortcut($startMenuLnk)
    $sc2.TargetPath = $InstalledExe
    $sc2.WorkingDirectory = $RepoRoot
    if (Test-Path $InstalledIco) {
        $sc2.IconLocation = "$InstalledIco,0"
    } else {
        $sc2.IconLocation = "$InstalledExe,0"
    }
    $sc2.Description = "omp-web Desktop Coding Agent (GUI)"
    $sc2.Save()
} catch {
    Write-Host "  [WARN] Failed to create Start Menu shortcut: $_" -ForegroundColor Yellow
}

# Clean up legacy NSIS installer shortcuts and stale executables
$legacyShortcuts = @(
    (Join-Path $desktopDir "ompweb-desktop.lnk"),
    (Join-Path $startMenuDir "ompweb-desktop.lnk")
)
foreach ($legacy in $legacyShortcuts) {
    if (Test-Path $legacy) {
        Remove-Item -Path $legacy -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] Cleaned up legacy shortcut: $legacy" -ForegroundColor Green
    }
}
$legacyInstallDir = Join-Path $env:LOCALAPPDATA "ompweb-desktop"
if ($legacyInstallDir -ne $TargetDir -and (Test-Path $legacyInstallDir)) {
    try {
        Remove-Item -Path $legacyInstallDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] Cleaned up legacy installation directory: $legacyInstallDir" -ForegroundColor Green
    } catch { }
}

# Ensure service configuration and repoRoot are saved in ~/.omp/agent/web-service.json
$AgentDir = Join-Path $env:USERPROFILE ".omp\agent"
if (!(Test-Path $AgentDir)) { New-Item -Path $AgentDir -ItemType Directory -Force | Out-Null }
$ConfigPath = Join-Path $AgentDir "web-service.json"
$configData = @{}
if (Test-Path $ConfigPath) {
    try {
        $raw = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        foreach ($prop in $raw.PSObject.Properties) {
            $configData[$prop.Name] = $prop.Value
        }
    } catch { }
}
$configData["repoRoot"] = $RepoRoot
if (!$configData.ContainsKey("port")) { $configData["port"] = 30177 }
if (!$configData.ContainsKey("hostname")) { $configData["hostname"] = "127.0.0.1" }
if (!$configData.ContainsKey("mode")) { $configData["mode"] = "start" }
$configData | ConvertTo-Json -Depth 4 | Set-Content -Path $ConfigPath -Force
Write-Host "  [OK] Repository root registered: $RepoRoot" -ForegroundColor Green

# Clean up conflicting legacy Web tray service and shortcuts (as Desktop integrates tray functionality)
if (!$KeepWebTray) {
    Write-Host "`nCleaning up legacy separate Web tray service (integrated into Desktop app)..." -ForegroundColor Cyan
    $uninstallTrayScript = Join-Path $RepoRoot "scripts\windows\uninstall-tray.ps1"
    if (Test-Path $uninstallTrayScript) {
        try {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $uninstallTrayScript -Quiet
            Write-Host "  [OK] Cleaned up legacy separate Web tray service." -ForegroundColor Green
        } catch {
            Write-Host "  [WARN] Failed to invoke uninstall-tray.ps1: $_" -ForegroundColor Yellow
        }
    }
}

# 3. Startup Shortcut (if autostart enabled)
if ($Autostart) {
    $startupDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Startup)
    $startupLnk = Join-Path $startupDir "omp-web Desktop.lnk"
    try {
        $sc3 = $wsh.CreateShortcut($startupLnk)
        $sc3.TargetPath = $InstalledExe
        $sc3.WorkingDirectory = $RepoRoot
        if (Test-Path $InstalledIco) {
            $sc3.IconLocation = "$InstalledIco,0"
        } else {
            $sc3.IconLocation = "$InstalledExe,0"
        }
        $sc3.Description = "omp-web Desktop Coding Agent (GUI)"
        $sc3.Save()
        Write-Host "  [OK] Windows Startup shortcut created: $startupLnk" -ForegroundColor Green
    } catch {
        Write-Host "  [WARN] Failed to create Startup shortcut: $_" -ForegroundColor Yellow
    }
}

Write-Host "`nInstallation completed successfully!" -ForegroundColor Cyan
Write-Host "Executable: $InstalledExe"
Write-Host "Desktop Shortcut: $desktopLnk"
Write-Host "Start Menu Shortcut: $startMenuLnk"
if ($Autostart) {
    Write-Host "Startup Shortcut: $startupLnk"
}

if ($Launch) {
    Write-Host "`nLaunching omp-web Desktop..." -ForegroundColor Green
    Start-Process -FilePath $InstalledExe -WorkingDirectory $RepoRoot
}
