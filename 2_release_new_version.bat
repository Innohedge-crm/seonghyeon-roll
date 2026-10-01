@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [성현교회 출석부] 새 버전 배포
set /p MSG=이번에 바뀐 내용 한 줄: 
if "%MSG%"=="" set MSG=업데이트
call node build-gas.js
git add -A
git commit -m "%MSG%"
call npm version patch -m "v%%s - %MSG%"
if errorlevel 1 goto :fail
git push
git push --tags
echo.
echo 올렸습니다. 약 5~10분 뒤 GitHub Releases에 새 버전이 생기고,
echo 프로그램을 쓰는 PC는 다음에 켤 때 자동으로 업데이트됩니다.
pause
goto :eof
:fail
echo 버전 올리기에 실패했습니다. 위 메시지를 확인하세요.
pause
