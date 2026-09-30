@echo off
title STB PLAY - Latest Installer
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Latest.ps1"
if errorlevel 1 pause
