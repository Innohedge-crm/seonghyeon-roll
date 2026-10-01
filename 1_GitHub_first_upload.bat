@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [성현교회 출석부] GitHub 처음 올리기
echo GitHub에서 빈 저장소를 먼저 만드세요 (README 추가하지 않음).
set /p URL=저장소 주소 (예: https://github.com/아이디/seonghyeon-roll.git): 
if "%URL%"=="" goto :eof
git init
git add -A
git commit -m "성현교회 출석부 첫 버전"
git branch -M main
git remote add origin %URL%
git push -u origin main
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set VER=%%v
git tag v%VER%
git push origin v%VER%
echo.
echo 완료. GitHub의 Actions 탭에서 설치 파일 만드는 과정을 볼 수 있습니다 (약 5~10분).
echo 끝나면 Releases 탭에서 SeonghyeonRoll-Setup-%VER%.exe 를 받아 설치하세요.
pause
