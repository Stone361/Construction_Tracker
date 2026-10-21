@echo off
rem Forward root-level Maven commands to the backend project.
setlocal
pushd "%~dp0backend"
if errorlevel 1 exit /b 1
call ".\mvnw.cmd" %*
set "CT_MAVEN_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %CT_MAVEN_EXIT_CODE%
