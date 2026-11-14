# 启动 Electron 开发环境:后台 Vite 开发服务器 + Electron 窗口,退出时自动清理
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# VS Code 会给终端注入 ELECTRON_RUN_AS_NODE,导致 electron 以纯 Node 启动而非桌面应用
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

if (!(Test-Path "$root/wolffia-ui/node_modules")) {
    Push-Location ./wolffia-ui
    npm install
    Pop-Location
}

# --strictPort:5173 被占用时直接失败,而不是漂移端口导致 Electron 连错地址
# npm 可能是 mise 等版本管理器的 shim(Get-Command 解析不到完整路径),交由 cmd 解析
$vite = Start-Process cmd -ArgumentList "/c", "npm run dev -- --strictPort" `
    -WorkingDirectory "$root/wolffia-ui" -PassThru -NoNewWindow

try {
    # 等待 Vite 就绪(最多 60 秒)
    $ready = $false
    foreach ($i in 1..120) {
        try {
            Invoke-WebRequest -Uri http://localhost:5173 -UseBasicParsing -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (!$ready) { throw "Vite 开发服务器 60 秒内未就绪,请检查 5173 端口占用" }

    Push-Location ./wolffia-ui
    npm run electron:dev
    Pop-Location
} finally {
    # 连子进程(node/vite)一起清理,防止孤儿进程常驻
    taskkill /PID $vite.Id /T /F 2>$null | Out-Null
}
