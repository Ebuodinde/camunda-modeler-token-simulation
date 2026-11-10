@echo off
chcp 65001 >nul
title Camunda Modeler v4.7 — BPMN Token Simulation & Validation Installer
echo ============================================================================
echo   BPMN 2.0 Token Simulation ^& Validation Plugin Installer (Camunda v4.7)
echo ============================================================================
echo.

set "PLUGINS_ROOT=%APPDATA%\camunda-modeler\resources\plugins"
set "TARGET_DIR=%PLUGINS_ROOT%\bpmn-token-simulation"

if not exist "%PLUGINS_ROOT%" (
    mkdir "%PLUGINS_ROOT%"
)
if exist "%TARGET_DIR%" (
    rmdir /s /q "%TARGET_DIR%"
)
mkdir "%TARGET_DIR%\client"
mkdir "%TARGET_DIR%\style"

copy /Y "%~dp0index.js" "%TARGET_DIR%\index.js" >nul
copy /Y "%~dp0package.json" "%TARGET_DIR%\package.json" >nul
copy /Y "%~dp0client\client.js" "%TARGET_DIR%\client\client.js" >nul
copy /Y "%~dp0style\style.css" "%TARGET_DIR%\style\style.css" >nul

if not exist "%APPDATA%\camunda-modeler\resources\flags.json" (
    copy /Y "%~dp0flags.json" "%APPDATA%\camunda-modeler\resources\flags.json" >nul
)

echo Installed successfully to:
echo   "%TARGET_DIR%"
echo.
echo Restart Camunda Modeler v4.7 to use Token Simulation and Validate.
echo.
pause
