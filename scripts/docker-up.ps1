param(
  [switch]$Build,
  [switch]$Detached = $true
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path '.env')) {
  if (Test-Path '.env.docker.example') {
    Copy-Item '.env.docker.example' '.env'
    Write-Host '已根据 .env.docker.example 创建 .env，请先补充 JWT_SECRET / SILICONFLOW_API_KEY 后再重新执行。'
    exit 0
  }

  Write-Error '缺少 .env，且未找到 .env.docker.example。'
}

$args = @('compose', 'up')
if ($Build) {
  $args += '--build'
}
if ($Detached) {
  $args += '-d'
}

& docker @args