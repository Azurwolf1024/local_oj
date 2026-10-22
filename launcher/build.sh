#!/usr/bin/env bash
# Build the Local OJ tray launcher (MinGW-w64) from Git Bash / MSYS2.
set -e
cd "$(dirname "$0")"

echo "[1/3] Generating icon..."
python3 make_icon.py || python make_icon.py

echo "[2/3] Compiling resources..."
windres launcher.rc -O coff -o launcher_res.o

echo "[3/3] Linking standalone EXE..."
g++ -O2 -mwindows -static -static-libgcc -static-libstdc++ \
  launcher.cpp launcher_res.o \
  -o ../local_oj_launcher.exe \
  -lws2_32 -lshell32 -luser32 -lgdi32 -lkernel32 -lcomdlg32

echo
echo "Build OK: ../local_oj_launcher.exe"
