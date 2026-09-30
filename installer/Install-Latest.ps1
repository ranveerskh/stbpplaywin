$ErrorActionPreference = 'Stop'
$repo = 'ranveerskh/stbpplaywin'
$api = "https://api.github.com/repos/$repo/releases/latest"
$headers = @{ 'User-Agent' = 'STB-PLAY-Updater' }

Write-Host 'STB PLAY - checking for the latest installer...'
$response = $null
try {
  $response = Invoke-WebRequest -Uri $api -Headers $headers -UseBasicParsing
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  if ($status -eq 404) {
    throw "No published STB PLAY release was found yet. Please ask the publisher to create a GitHub Release first."
  }
  throw
}
$release = $response.Content | ConvertFrom-Json
$asset = $release.assets | Where-Object { $_.name -match '^STB-PLAY-Setup-.*\.exe$|^Netplus-IPTV-Player-Setup-.*\.exe$' } | Select-Object -First 1
if (-not $asset) { throw 'No Windows installer was found in the latest GitHub release.' }

$target = Join-Path ([IO.Path]::GetTempPath()) $asset.name
Write-Host ("Downloading STB PLAY {0}..." -f $release.tag_name)
Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $target
if (-not (Test-Path $target)) { throw 'The latest installer could not be downloaded.' }
Start-Process -FilePath $target -Wait
Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
