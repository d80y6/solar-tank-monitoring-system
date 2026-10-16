$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$LogDir = Join-Path $ProjectDir "backups\logs"
$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$LogPath = Join-Path $LogDir "mysql_backup_$Timestamp.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $ProjectDir

"[$(Get-Date -Format o)] Mulai backup MySQL SolarTank" | Out-File -FilePath $LogPath -Encoding utf8
"Project: $ProjectDir" | Out-File -FilePath $LogPath -Encoding utf8 -Append

pnpm db:backup:mysql *>&1 | Tee-Object -FilePath $LogPath -Append

if ($LASTEXITCODE -ne 0) {
  throw "MySQL backup failed. Check the log: $LogPath"
}

"[$(Get-Date -Format o)] MySQL backup completed" | Out-File -FilePath $LogPath -Encoding utf8 -Append
