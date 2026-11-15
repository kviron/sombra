$ErrorActionPreference = 'Stop'
# Windows cannot replace an executable while a previous preview is running.
# Match full paths so other installed copies of Mines are left alone.
$buildExecutables = @(
    [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'target/debug/mines-chat.exe')),
    [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'target/release/mines-chat.exe'))
)
Get-Process -Name 'mines-chat' -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Path -and $buildExecutables -contains $_.Path) {
        Write-Host "Closing previous Mines build (PID $($_.Id))."
        Stop-Process -Id $_.Id -Force
        $_.WaitForExit()
    }
}
