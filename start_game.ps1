$ErrorActionPreference = "SilentlyContinue"

$ProjectDir = "C:\Users\Doohee Cho\Desktop\github\New Game"
$Python = "C:\Users\Doohee Cho\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$Port = 5173
$Url = "http://127.0.0.1:$Port/index.html"

function Test-GameServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-Path $Python)) {
  $Python = "python"
}

if (-not (Test-GameServer)) {
  Start-Process -FilePath $Python -ArgumentList @("-m", "http.server", "$Port", "--bind", "127.0.0.1") -WorkingDirectory $ProjectDir -WindowStyle Hidden
  Start-Sleep -Milliseconds 900
}

Start-Process $Url
