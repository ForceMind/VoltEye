param(
  [int]$StartPort = 3000,
  [int]$EndPort = 3999,
  [int]$PollIntervalMinutes = 30,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

function Get-PlainTextFromSecureString {
  param([System.Security.SecureString]$Secure)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Find-FreeTcpPort {
  param(
    [int]$FromPort,
    [int]$ToPort
  )

  for ($p = $FromPort; $p -le $ToPort; $p++) {
    try {
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
      $listener.Start()
      $listener.Stop()
      return $p
    }
    catch {
      continue
    }
  }

  throw "No free port found in range $FromPort-$ToPort"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js not found. Please install Node.js >= 20."
}

$mobile = Read-Host "TCNest login mobile"
$securePassword = Read-Host "TCNest login password" -AsSecureString
$password = Get-PlainTextFromSecureString -Secure $securePassword

if ([string]::IsNullOrWhiteSpace($mobile) -or [string]::IsNullOrWhiteSpace($password)) {
  throw "Mobile and password are required."
}

$port = Find-FreeTcpPort -FromPort $StartPort -ToPort $EndPort
$tempRoot = Join-Path $env:TEMP "volteye-local-test"
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$dataFile = Join-Path $tempRoot ("balance-history-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$syncKey = [Guid]::NewGuid().ToString("N")

$env:SITE_MOBILE = $mobile
$env:SITE_PASSWORD = $password
$env:PORT = "$port"
$env:POLL_INTERVAL_MINUTES = "$PollIntervalMinutes"
$env:LOW_BALANCE_THRESHOLD = "50"
$env:DATA_FILE = $dataFile
$env:SYNC_API_KEY = $syncKey
$env:CONTRACT_ID = ""
$env:SMART_KEY = ""
$env:ALERT_WEBHOOK_URL = ""

Write-Host ""
Write-Host "Local test environment ready:"
Write-Host "  URL: http://127.0.0.1:$port"
Write-Host "  SYNC_API_KEY: $syncKey"
Write-Host "  Temp data file: $dataFile"
Write-Host ""
Write-Host "Press Ctrl+C to stop."

if (-not $NoBrowser) {
  Start-Process "http://127.0.0.1:$port" | Out-Null
}

try {
  node src/index.js
}
finally {
  Remove-Item Env:SITE_MOBILE -ErrorAction SilentlyContinue
  Remove-Item Env:SITE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PORT -ErrorAction SilentlyContinue
  Remove-Item Env:POLL_INTERVAL_MINUTES -ErrorAction SilentlyContinue
  Remove-Item Env:LOW_BALANCE_THRESHOLD -ErrorAction SilentlyContinue
  Remove-Item Env:DATA_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:SYNC_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:CONTRACT_ID -ErrorAction SilentlyContinue
  Remove-Item Env:SMART_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:ALERT_WEBHOOK_URL -ErrorAction SilentlyContinue
  Remove-Item -Path $dataFile -Force -ErrorAction SilentlyContinue
}
