[CmdletBinding()]
param(
    [string]$Message = 'chore: update career website deployment',
    [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$expectedBranch = 'main'
$expectedRemote = 'https://github.com/Adastra867/university-career-explorer.git'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = $null
$previousLocation = Get-Location

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed (exit $LASTEXITCODE). Deployment stopped."
    }
}

function Get-GitText {
    param([string[]]$Arguments)
    $result = & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Git check failed (exit $LASTEXITCODE)." }
    return (($result | Out-String).Trim())
}

function Assert-Repository {
    $branch = Get-GitText -Arguments @('branch', '--show-current')
    if ($branch -ne $expectedBranch) { throw "Switch to '$expectedBranch' before deploying. Current branch: '$branch'." }
    foreach ($direction in @('fetch', 'push')) {
        $remoteArguments = @('remote', 'get-url', '--all')
        if ($direction -eq 'push') { $remoteArguments += '--push' }
        $remoteArguments += 'origin'
        $remote = Get-GitText -Arguments $remoteArguments
        if ($remote -ne $expectedRemote) { throw "origin $direction URL does not match this project's original GitHub repository. Review it without publishing." }
    }
    $conflicts = Get-GitText -Arguments @('diff', '--name-only', '--diff-filter=U')
    if ($conflicts) { throw 'Unresolved merge conflicts exist. Resolve and review them before deploying.' }
    foreach ($state in @('MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD')) {
        $statePath = Get-GitText -Arguments @('rev-parse', '--git-path', $state)
        if (Test-Path -LiteralPath $statePath) { throw "An unfinished Git operation exists ($state). Finish it before deploying." }
    }
}

function Assert-RemoteHistory {
    Invoke-Checked -Command 'git' -Arguments @('fetch', 'origin', $expectedBranch)
    $counts = (Get-GitText -Arguments @('rev-list', '--left-right', '--count', "HEAD...refs/remotes/origin/$expectedBranch")) -split '\s+'
    if ($counts.Count -ne 2) { throw 'Could not compare local and remote history.' }
    if ([int]$counts[1] -gt 0) {
        throw "Remote '$expectedBranch' contains $($counts[1]) commits missing locally. Save your work, merge or rebase safely, resolve conflicts and run this command again. No automatic stash or history replacement was performed."
    }
}

try {
    Set-Location -LiteralPath $repositoryRoot
    foreach ($command in @('git', 'node', 'pnpm')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command '$command' is unavailable. Install Node.js 24+, pnpm and Git first." }
    }
    $nodeVersion = & node --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.') { throw 'Could not detect the Node.js version.' }
    if ([int]$Matches[1] -lt 24) { throw 'Node.js 24 or newer is required.' }
    Assert-Repository
    Write-Host 'Current Git worktree:'
    Invoke-Checked -Command 'git' -Arguments @('status', '--short', '--branch')
    Assert-RemoteHistory
    Invoke-Checked -Command 'node' -Arguments @('scripts/check-deploy.mjs')
    Invoke-Checked -Command 'pnpm' -Arguments @('install', '--frozen-lockfile')
    $package = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
    foreach ($script in @('check', 'test', 'build')) {
        if ($package.scripts.PSObject.Properties.Name -contains $script) {
            Invoke-Checked -Command 'pnpm' -Arguments @('run', $script)
        }
    }
    # Tests/installers can generate files. Recheck after they have finished.
    Invoke-Checked -Command 'node' -Arguments @('scripts/check-deploy.mjs')
    Assert-Repository
    Assert-RemoteHistory
    if ($CheckOnly) {
        Write-Host 'Checks passed. CheckOnly did not stage, commit or push.'
        return
    }

    $manifestPath = [System.IO.Path]::GetTempFileName()
    Invoke-Checked -Command 'node' -Arguments @('scripts/check-deploy.mjs', '--manifest', $manifestPath)
    Invoke-Checked -Command 'git' -Arguments @('--literal-pathspecs', 'add', '--all', "--pathspec-from-file=$manifestPath", '--pathspec-file-nul')
    Invoke-Checked -Command 'node' -Arguments @('scripts/check-deploy.mjs', '--staged')
    & git diff --cached --quiet
    $diffExit = $LASTEXITCODE
    if ($diffExit -eq 1) {
        if ([string]::IsNullOrWhiteSpace($Message)) { throw 'Commit message must not be empty.' }
        Invoke-Checked -Command 'git' -Arguments @('commit', '-m', $Message)
    } elseif ($diffExit -eq 0) {
        Write-Host 'No file changes to commit.'
    } else {
        throw "Could not inspect staged changes (exit $diffExit)."
    }
    # A commit hook may change the tree or a collaborator may update the branch.
    $remaining = Get-GitText -Arguments @('status', '--porcelain')
    if ($remaining) { throw 'The worktree changed during the checks or commit. Review changes and rerun deployment before pushing.' }
    Assert-Repository
    Assert-RemoteHistory
    $ahead = Get-GitText -Arguments @('rev-list', '--count', "refs/remotes/origin/$expectedBranch..HEAD")
    if ([int]$ahead -gt 0) {
        Invoke-Checked -Command 'git' -Arguments @('push', 'origin', "HEAD:refs/heads/$expectedBranch")
    } else {
        Write-Host 'GitHub is already up to date; no push or empty commit was needed.'
    }
    Write-Host 'GitHub synchronization complete. Render On Commit deployment is asynchronous.'
    Write-Host 'Verify the matching commit is live in the existing Render service, then open https://university-career-explorer.onrender.com.'
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
} finally {
    if ($manifestPath -and (Test-Path -LiteralPath $manifestPath)) { Remove-Item -LiteralPath $manifestPath -Force }
    Set-Location -LiteralPath $previousLocation.Path
}
