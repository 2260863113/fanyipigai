@echo off
chcp 65001 >nul
title 英语翻译练习站 - 本地开发服务
cd /d "%~dp0"

rem 双击本文件即可启动。所有检查与提示都在 start.ps1 里，
rem 这里只负责以"绕过执行策略"的方式调用它，避免被系统拦下。

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*

if errorlevel 1 (
  echo.
  echo 启动过程出现问题，请把上面的信息发给开发者。
  pause
)
