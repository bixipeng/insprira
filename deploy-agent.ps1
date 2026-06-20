# insprira Agent 配置重构部署脚本
# 将 Agent 配置从 LLM 模式改为 Agent 网关模式（对接 Openclaw）

$VPS = "tx-bot"
$FILES = @(
    "server.js",
    "js/pages/settings.js",
    "js/pages/agent.js",
    "js/app.js",
    "index.html",
    ".env.example"
)

Write-Host "=== 上传文件到 VPS ===" -ForegroundColor Cyan
foreach ($f in $FILES) {
    Write-Host "  上传: $f" -ForegroundColor Yellow
    scp "d:/Work/Source/insprira/$f" "root@${VPS}:/tmp/insprira-deploy/"
}

Write-Host ""
Write-Host "=== 部署到 Docker 容器 ===" -ForegroundColor Cyan
$cmds = @(
    "docker cp /tmp/insprira-deploy/server.js insprira:/app/server.js",
    "docker cp /tmp/insprira-deploy/settings.js insprira:/app/js/pages/settings.js",
    "docker cp /tmp/insprira-deploy/agent.js insprira:/app/js/pages/agent.js",
    "docker cp /tmp/insprira-deploy/app.js insprira:/app/js/app.js",
    "docker cp /tmp/insprira-deploy/index.html insprira:/app/index.html",
    "docker cp /tmp/insprira-deploy/.env.example insprira:/app/.env.example",
    "docker restart insprira",
    "echo '=== 部署完成 ==='",
    "sleep 3",
    "curl -s http://localhost:8080/api/_/status | head -c 200",
    "rm -rf /tmp/insprira-deploy"
)
$cmdStr = $cmds -join " && "
ssh root@$VPS $cmdStr

Write-Host ""
Write-Host "=== 部署完成 ===" -ForegroundColor Green
Write-Host "请在浏览器中打开 insprira 设置页，添加 Openclaw Agent 配置："
Write-Host "  URL: http://1panel.owmini.com:18789"
Write-Host "  Token: n4qekyrbznek665tfr2dxx8wx52bjxz3"
Write-Host "  Agent ID: openclaw/default"
