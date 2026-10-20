@echo off
chcp 65001 >nul
title Drum RM - construirea Drum_Analiza.exe
rem Se ruleaza o singura data, pe un calculator unde ai voie sa descarci programe (acasa).
rem Rezultatul: dist\Drum_Analiza\ - folderul se copiaza oriunde (stick, calculatorul de la lucru) si merge fara instalare.
set "AICI=%~dp0"
rem pentru .exe nu trebuie PyTorch (~3 GB): exe-ul lucreaza cu modelul .onnx
set "FARA_TORCH=1"
call "%AICI%_mediu.bat" || (pause & exit /b 1)
"%PY%" -m pip install pyinstaller tkinterdnd2 onnxruntime
"%PY%" -m PyInstaller --noconfirm --clean --windowed --name Drum_Analiza ^
  --distpath "%AICI%dist" --workpath "%AICI%build" --specpath "%AICI%build" ^
  --add-data "%AICI%model;model" ^
  --add-data "%AICI%env\Library\share\proj;proj" ^
  --add-data "%AICI%env\Library\share\gdal;gdal-data" ^
  --collect-all tkinterdnd2 ^
  --hidden-import osgeo._gdal --hidden-import osgeo._ogr --hidden-import osgeo._osr ^
  --hidden-import analiza --hidden-import gdb_scriere --hidden-import qgis_proiect ^
  --hidden-import osm_comparare --hidden-import trimite_portal --hidden-import panouri --hidden-import stil --hidden-import vizualizare --hidden-import fundal ^
  --exclude-module torch --exclude-module ultralytics --exclude-module torchvision ^
  --paths "%AICI%." "%AICI%gui.py"
if not exist "%AICI%dist\Drum_Analiza\Drum_Analiza.exe" (echo  Construirea a esuat. & pause & exit /b 1)
rem arhiva cu tar (inclus in Windows 10/11) - Compress-Archive sarea uneori fisiere
if exist "%AICI%dist\Drum_Analiza_portabil.zip" del /f /q "%AICI%dist\Drum_Analiza_portabil.zip"
pushd "%AICI%dist"
tar -a -c -f Drum_Analiza_portabil.zip Drum_Analiza
popd
for /f %%n in ('dir /s /b /a-d "%AICI%dist\Drum_Analiza" ^| find /c /v ""') do set "NRF=%%n"
for /f %%n in ('tar -t -f "%AICI%dist\Drum_Analiza_portabil.zip" ^| find /c /v ""') do set "NRZ=%%n"
echo  Fisiere in folder: %NRF%   Intrari in arhiva (cu foldere): %NRZ%
dir /s /b "%AICI%dist\Drum_Analiza\_internal\cv2*.pyd" >nul 2>&1 || echo  ATENTIE: lipseste OpenCV (cv2*.pyd) din _internal!

rem varianta AUTONOMA: un singur fisier .exe (la pornire se dezarhiveaza singur in Temp - porneste mai greu, 20-60 s)
echo.
echo  Construiesc si varianta intr-un singur fisier: dist\Drum_Analiza_autonom.exe ...
"%PY%" -m PyInstaller --noconfirm --onefile --windowed --name Drum_Analiza_autonom ^
  --distpath "%AICI%dist" --workpath "%AICI%build1" --specpath "%AICI%build1" ^
  --add-data "%AICI%model;model" ^
  --add-data "%AICI%env\Library\share\proj;proj" ^
  --add-data "%AICI%env\Library\share\gdal;gdal-data" ^
  --collect-all tkinterdnd2 ^
  --hidden-import osgeo._gdal --hidden-import osgeo._ogr --hidden-import osgeo._osr ^
  --hidden-import analiza --hidden-import gdb_scriere --hidden-import qgis_proiect ^
  --hidden-import osm_comparare --hidden-import trimite_portal --hidden-import panouri --hidden-import stil --hidden-import vizualizare --hidden-import fundal ^
  --exclude-module torch --exclude-module ultralytics --exclude-module torchvision ^
  --paths "%AICI%." "%AICI%gui.py"
if exist "%AICI%dist\Drum_Analiza_autonom.exe" (echo  Gata: dist\Drum_Analiza_autonom.exe - un singur fisier, se porneste direct) else (echo  Varianta autonoma a esuat - foloseste arhiva portabila.)
echo.
echo  Gata: dist\Drum_Analiza_portabil.zip  - dezarhivezi si pornesti Drum_Analiza.exe (porneste mai repede)
pause
