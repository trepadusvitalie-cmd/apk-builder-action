@echo off
chcp 65001 >nul
title Drum RM - trimitere pe portal
call "%~dp0_mediu.bat" || (pause & exit /b 1)
rem fara argument: ultimul rezultat; sau trage peste acest fisier folderul rezultatului / Drum.gdb
"%PY%" "%~dp0trimite_portal.py" %*
pause
