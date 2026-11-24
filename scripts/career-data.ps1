[CmdletBinding()]
param(
    [ValidateSet('Start', 'Stop', 'Status', 'InstallStartup', 'RemoveStartup')]
    [string]$Action = 'Status'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$envPath = Join-Path $repositoryRoot '.env.career-data'
$entryPath = Join-Path $repositoryRoot 'server.js'
$logDirectory = Join-Path $repositoryRoot 'logs'
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'CareerDataServer.vbs'
$scriptPath = Join-Path $PSScriptRoot 'career-data.ps1'
$envArgument = '"--env-file=' + $envPath + '"'
$entryArgument = '"' + $entryPath + '"'
$mutex = $null
$locked = $false

function Get-DataProcesses {
    # Match both absolute arguments, not a saved PID that Windows could reuse.
    @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $commandLine = if ($_.CommandLine) { $_.CommandLine.Replace('/', '\') } else { '' }
        ($commandLine.Contains($envArgument) -or $commandLine.Contains('--env-file="' + $envPath + '"')) -and
        $commandLine.Contains($entryArgument)
    })
}

function Read-DataPort {
    if (!(Test-Path -LiteralPath $envPath -PathType Leaf)) {
        throw 'Missing .env.career-data. Configure the local data origin first.'
    }
    $portMatches = @(Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*PORT\s*=' })
    if ($portMatches.Count -ne 1 -or $portMatches[0] -notmatch '^\s*PORT\s*=\s*["'']?(\d+)["'']?\s*(?:#.*)?$') {
        throw 'Set exactly one numeric PORT in .env.career-data.'
    }
    $dataPort = [int]$Matches[1]
    if ($dataPort -lt 1 -or $dataPort -gt 65535) { throw 'PORT must be between 1 and 65535.' }
    return $dataPort
}

function Assert-DataMode {
    $lines = @(Get-Content -LiteralPath $envPath)
    foreach ($setting in @{ CAREER_DATA_MODE = 'origin'; JOURNEY_LOAD_ENV = 'false'; NODE_ENV = 'production' }.GetEnumerator()) {
        $values = @($lines | Where-Object { $_ -match ('^\s*' + $setting.Key + '\s*=') })
        $pattern = '^\s*' + $setting.Key + '\s*=\s*["'']?' + $setting.Value + '["'']?\s*(?:#.*)?$'
        if ($values.Count -ne 1 -or $values[0] -notmatch $pattern) {
            throw "Set exactly one $($setting.Key)=$($setting.Value) in .env.career-data before starting."
        }
    }
}

function Get-DataListeners([int]$DataPort) {
    @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq $DataPort })
}

function Test-DataHealth([int]$DataPort) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$DataPort/healthz" -TimeoutSec 2
        return $response.ready -eq $true
    } catch { return $false }
}

function Assert-ListenerOwner($Listeners, $Processes) {
    $processIds = @($Processes | ForEach-Object { [int]$_.ProcessId })
    foreach ($listener in $Listeners) {
        if ($processIds -notcontains [int]$listener.OwningProcess) {
            throw "Port $($listener.LocalPort) is occupied by another process (PID $($listener.OwningProcess)). No process was stopped."
        }
        if ($listener.LocalAddress -ne '127.0.0.1') {
            throw 'The data origin must listen only on 127.0.0.1. Check CAREER_DATA_MODE=origin.'
        }
    }
}

try {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $rootHash = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($repositoryRoot.ToLowerInvariant()))).Replace('-', '') }
    finally { $hash.Dispose() }
    $mutex = New-Object Threading.Mutex($false, "Local\CareerData-$rootHash")
    try { $locked = $mutex.WaitOne(10000) }
    catch [Threading.AbandonedMutexException] { $locked = $true }
    if (!$locked) { throw 'Another career-data operation is running. Try again shortly.' }

    if ($Action -eq 'InstallStartup') {
        $null = Read-DataPort
        Assert-DataMode
        $powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $command = '"' + $powershellPath + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -Action Start'
        $vbs = "' Career data server: $scriptPath`r`nCreateObject(""WScript.Shell"").Run """ + $command.Replace('"', '""') + """, 0, False`r`n"
        if (Test-Path -LiteralPath $startupPath) {
            if ((Get-Content -LiteralPath $startupPath -Raw) -notmatch [regex]::Escape($scriptPath)) {
                throw 'A different CareerDataServer startup entry already exists. It was not overwritten.'
            }
        }
        [IO.File]::WriteAllText($startupPath, $vbs, [Text.Encoding]::Unicode)
        Write-Output "Login startup installed for the current Windows user: $startupPath"
        Write-Output 'This does not start the service now. Run -Action Start.'
        return
    }
    if ($Action -eq 'RemoveStartup') {
        if (Test-Path -LiteralPath $startupPath) {
            if ((Get-Content -LiteralPath $startupPath -Raw) -notmatch [regex]::Escape($scriptPath)) {
                throw 'The startup entry belongs to another location. It was not removed.'
            }
            Remove-Item -LiteralPath $startupPath
        }
        Write-Output 'Current-user login startup removed. Running services were not stopped.'
        return
    }

    $dataPort = Read-DataPort
    $processes = @(Get-DataProcesses)
    $listeners = @(Get-DataListeners $dataPort)
    Assert-ListenerOwner $listeners $processes
    if ($Action -eq 'Status') {
        [pscustomobject]@{
            Running = $processes.Count -gt 0
            Ready = ($listeners.Count -gt 0 -and (Test-DataHealth $dataPort))
            ProcessIds = ($processes | ForEach-Object { $_.ProcessId }) -join ','
            Address = "http://127.0.0.1:$dataPort"
            LoginStartup = (Test-Path -LiteralPath $startupPath)
            Logs = $logDirectory
        }
        return
    }
    if ($Action -eq 'Stop') {
        foreach ($process in $processes) {
            # Query again immediately before stopping to reject a reused PID.
            $current = @(Get-DataProcesses | Where-Object { $_.ProcessId -eq $process.ProcessId -and $_.CreationDate -eq $process.CreationDate })
            if ($current.Count -eq 1) {
                Stop-Process -Id $process.ProcessId -ErrorAction Stop
                Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
            }
        }
        Write-Output 'Local data server stopped. Database files and tunnel settings were preserved.'
        return
    }
    if ($processes.Count -gt 0) {
        if ($processes.Count -eq 1 -and $listeners.Count -gt 0 -and (Test-DataHealth $dataPort)) {
            Write-Output "Local data server is already ready at http://127.0.0.1:$dataPort."
            return
        }
        throw 'A matching data process exists but is not ready. Inspect logs; run -Action Stop before restarting.'
    }

    Assert-DataMode
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $nodeVersion = & $nodePath --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) {
        throw 'Node.js 24 or newer is required.'
    }
    if (!(Test-Path -LiteralPath (Join-Path $repositoryRoot 'node_modules/express'))) { throw 'Dependencies are missing. Run pnpm install --frozen-lockfile first.' }
    $null = New-Item -ItemType Directory -Path $logDirectory -Force
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdoutPath = Join-Path $logDirectory "career-data-$stamp.out.log"
    $stderrPath = Join-Path $logDirectory "career-data-$stamp.err.log"
    # Node's --env-file does not override inherited environment variables. Remove
    # application overrides from this shell only while creating the child.
    $savedEnvironment = @{}
    foreach ($item in @(Get-ChildItem Env: | Where-Object { $_.Name -match '^(?:CAREER_|JOURNEY_|DEEPSEEK_|RENDER(?:_|$)|NODE_ENV$|PORT$|DEPLOY_RUN_PORT$)' })) {
        $savedEnvironment[$item.Name] = $item.Value
        [Environment]::SetEnvironmentVariable($item.Name, $null, 'Process')
    }
    try {
        $child = Start-Process -FilePath $nodePath -ArgumentList @($envArgument, $entryArgument) -WorkingDirectory $repositoryRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    } finally {
        foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 500
        $child.Refresh()
        if ($child.HasExited) { throw "Data server exited. Inspect $stderrPath" }
        $listeners = @(Get-DataListeners $dataPort)
        Assert-ListenerOwner $listeners @([pscustomobject]@{ ProcessId = $child.Id })
        if ($listeners.Count -gt 0 -and (Test-DataHealth $dataPort)) {
            Write-Output "Local data server ready at http://127.0.0.1:$dataPort (PID $($child.Id))."
            Write-Output "Logs: $logDirectory"
            return
        }
    }
    throw "Data server started but readiness was not confirmed. Inspect $stderrPath; use -Action Status before retrying."
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}
