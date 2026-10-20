@echo off
rem Mediul Python al analizei (folderul env, creat la prima pornire).
set "AICI=%~dp0"
set "PY=%AICI%env\python.exe"
set "PATH=%AICI%env;%AICI%env\Library\bin;%AICI%env\Scripts;%PATH%"
set "PROJ_DATA=%AICI%env\Library\share\proj"
set "GDAL_DATA=%AICI%env\Library\share\gdal"
set "PYTHONIOENCODING=utf-8"
if exist "%PY%" exit /b 0

echo.
echo  Prima pornire: se instaleaza programele necesare (o singura data).
echo  Dureaza 10-20 minute; ~4 GB cu PyTorch, ~1 GB fara. Calculatorul trebuie sa aiba internet.
echo.
set "MM=%AICI%unelte\micromamba.exe"
if not exist "%MM%" (
  mkdir "%AICI%unelte" 2>nul
  rem intai de pe conda-forge, de unde vin si celelalte pachete; apoi de pe GitHub
  curl.exe -fL --retry 3 -o "%AICI%unelte\mm.tar.bz2" "https://conda.anaconda.org/conda-forge/win-64/micromamba-2.0.5-0.tar.bz2"
  if exist "%AICI%unelte\mm.tar.bz2" tar -xjf "%AICI%unelte\mm.tar.bz2" -C "%AICI%unelte" Library/bin/micromamba.exe
  if exist "%AICI%unelte\Library\bin\micromamba.exe" move /y "%AICI%unelte\Library\bin\micromamba.exe" "%MM%" >nul
  if not exist "%MM%" curl.exe -fL --retry 3 -o "%MM%" "https://github.com/mamba-org/micromamba-releases/releases/download/2.0.5-0/micromamba-win-64"
  if not exist "%MM%" powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12 -bor 12288; Invoke-WebRequest -UseBasicParsing 'https://conda.anaconda.org/conda-forge/win-64/micromamba-2.0.5-0.tar.bz2' -OutFile '%AICI%unelte\mm.tar.bz2'; tar -xjf '%AICI%unelte\mm.tar.bz2' -C '%AICI%unelte' Library/bin/micromamba.exe; Move-Item -Force '%AICI%unelte\Library\bin\micromamba.exe' '%MM%'"
  if not exist "%MM%" (echo  Nu s-a putut descarca micromamba. Verifica internetul. & exit /b 1)
)
set "MAMBA_ROOT_PREFIX=%AICI%unelte\mamba"
"%MM%" create -y -p "%AICI%env" -c conda-forge python=3.11 gdal=3.9 pyproj opencv numpy
if not exist "%PY%" (echo  Instalarea Python a esuat. & exit /b 1)
"%PY%" -m pip install --upgrade pip
if "%FARA_TORCH%"=="1" goto fara_torch
where nvidia-smi >nul 2>nul
if %errorlevel%==0 (
  echo  Placa video NVIDIA gasita: PyTorch cu CUDA.
  "%PY%" -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
) else (
  "%PY%" -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
)
"%PY%" -m pip install ultralytics
:fara_torch
"%PY%" -m pip install onnxruntime
rmdir /s /q "%AICI%unelte\mamba\pkgs" 2>nul
echo  Instalare gata.
exit /b 0
