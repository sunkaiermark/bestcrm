$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$node = 'C:\Users\sun\AppData\Local\Programs\NodeJS\node-v24.22.0-win-x64\node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js not found.' }
$secureKey = Read-Host 'Paste BESTCRM API Key (hidden input)' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $env:LAB_ARK_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer).Trim()
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    $secureKey.Dispose()
}
if ([string]::IsNullOrWhiteSpace($env:LAB_ARK_API_KEY)) { throw 'API Key is empty.' }
$env:LAB_ARK_MODEL = 'doubao-seed-2-1-pro-260915'
$env:LAB_SEARCH_ENABLED = 'true'
$env:LAB_CALL_LIMIT = '5'
$env:LEAD_AI_LAB_PORT = '3012'
try {
    Write-Host 'Open http://127.0.0.1:3012/ ; text extraction and customer web research, maximum 5 requests. Ctrl+C to stop.'
    & $node scripts/lead-ai-lab.mjs
} finally {
    Remove-Item Env:LAB_ARK_API_KEY -ErrorAction SilentlyContinue
}