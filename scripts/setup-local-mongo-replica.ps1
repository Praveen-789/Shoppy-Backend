$ErrorActionPreference = 'Stop'
$configPath = 'C:\Program Files\MongoDB\Server\8.2\bin\mongod.cfg'
$statusPath = 'D:\Shoppy\shoppy-node\scripts\mongo-replica-setup-status.txt'
try {
  $configText = [System.IO.File]::ReadAllText($configPath)
  if ($configText -notmatch '(?m)^replication:') {
    $backupPath = $configPath + '.before-shoppy-replica.bak'
    if (!(Test-Path -LiteralPath $backupPath)) { Copy-Item -LiteralPath $configPath -Destination $backupPath }
    $newConfig = $configText.Replace('#replication:', "replication:" + [Environment]::NewLine + '  replSetName: shoppy-rs')
    if ($newConfig -eq $configText) { throw 'Replication placeholder missing. No configuration changed.' }
    [System.IO.File]::WriteAllText($configPath, $newConfig)
    try { Restart-Service -Name MongoDB }
    catch {
      [System.IO.File]::WriteAllText($configPath, $configText)
      Start-Service -Name MongoDB
      throw
    }
  }
  [System.IO.File]::WriteAllText($statusPath, 'SUCCESS')
} catch { [System.IO.File]::WriteAllText($statusPath, 'FAILED: ' + $_.Exception.Message); exit 1 }
