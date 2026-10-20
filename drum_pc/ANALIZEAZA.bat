@echo off
chcp 65001 >nul
title Drum RM - analiza filmarilor
call "%~dp0_mediu.bat" || (pause & exit /b 1)
"%PY%" "%~dp0analiza.py" %*
echo.
echo  Rezultatul e in folderul "rezultat". Pentru portal: TRIMITE_PE_PORTAL.bat
pause
