function quotePowerShell(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function buildWindowsUpdateLauncher({ installerPath, logPath, processIds = [] }) {
  const ids = [...new Set(processIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  return [
    "$ErrorActionPreference = 'Stop'",
    `$installer = ${quotePowerShell(installerPath)}`,
    `$log = ${quotePowerShell(logPath)}`,
    "('Updater helper started at ' + (Get-Date).ToString('o')) | Out-File -LiteralPath $log -Encoding utf8 -Append",
    "try {",
    `foreach ($processId in @(${ids.join(",")})) {`,
    "  $deadline = (Get-Date).AddMinutes(2)",
    "  while ((Get-Process -Id $processId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {",
    "    Start-Sleep -Milliseconds 250",
    "  }",
    "  if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw \"STB PLAY process $processId did not close.\" }",
    "}",
    "if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'The downloaded installer is missing.' }",
    "('Starting installer at ' + (Get-Date).ToString('o')) | Out-File -LiteralPath $log -Encoding utf8 -Append",
    "$started = Start-Process -FilePath $installer -WorkingDirectory (Split-Path -Parent $installer) -PassThru",
    "if (-not $started) { throw 'Windows did not start the installer.' }",
    "('Installer started with process ID ' + $started.Id) | Out-File -LiteralPath $log -Encoding utf8 -Append",
    "exit 0",
    "} catch {",
    "  ($_ | Out-String) | Out-File -LiteralPath $log -Encoding utf8 -Append",
    "  try {",
    "    Add-Type -AssemblyName System.Windows.Forms",
    "    [System.Windows.Forms.MessageBox]::Show(('STB PLAY downloaded the update but could not start setup. Open the installer from your Temp folder. Details: ' + $log), 'STB PLAY update') | Out-Null",
    "  } catch {}",
    "  exit 1",
    "}",
  ].join("\r\n");
}

module.exports = { buildWindowsUpdateLauncher };
