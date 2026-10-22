@echo off
REM Build the Local OJ tray launcher into a standalone Windows EXE.
REM Requires MinGW-w64 g++ and windres on PATH (or edit GCC below).
setlocal
cd /d "%~dp0"

set GCC=g++
where g++ >nul 2>&1 || set GCC=C:\msys64\mingw64\bin\g++.exe

echo [1/3] Generating icon...
py -3 make_icon.py >nul 2>&1 || python make_icon.py
if not exist app.ico (
  echo Failed to generate app.ico
  exit /b 1
)

echo [2/3] Compiling resources...
windres launcher.rc -O coff -o launcher_res.o
if errorlevel 1 exit /b 1

echo [3/3] Linking standalone EXE (static, no console)...
%GCC% -O2 -mwindows -static -static-libgcc -static-libstdc++ ^
  launcher.cpp launcher_res.o ^
  -o ..\local_oj_launcher.exe ^
  -lws2_32 -lshell32 -luser32 -lgdi32 -lkernel32
if errorlevel 1 exit /b 1

echo.
echo Build OK: ..\local_oj_launcher.exe
echo Double-click it to launch Local OJ with a tray icon.
endlocal
