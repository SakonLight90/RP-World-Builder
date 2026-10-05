@echo off
setlocal

rem Starts the platform on Windows: the API and the interface, together.
rem
rem   start.bat      production: builds if the sources changed, then serves compiled
rem   dev.bat        development: pages compiled on every request (dev.bat calls this)
rem
rem The difference matters when judging speed: `next dev` recompiles a page on
rem every request. Measured on this project, `/` took 3121 ms that way and 17 ms
rem built. A development build cannot tell you whether the platform is fast.
rem
rem Everything this script does before starting is a check, and every check
rem ends in a sentence a person can act on. A launcher that fails obscurely is
rem worse than one that refuses to start: "it says nothing" is indistinguishable
rem from "it is still starting".

rem The folder name can contain a space, so the path is quoted and entered
rem rather than run from wherever the double-click happened to happen.
cd /d "%~dp0"

echo Starting RP World Builder...
echo.

rem --- 1. Node ---------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 goto :no_node

rem --- 2. The Node version this project asks for ------------------------------
rem The requirement is read from package.json rather than repeated here, so the
rem two cannot disagree.
node -e "const p=require('./package.json');const have=+process.versions.node.split('.')[0];const need=+((p.engines&&p.engines.node||'').match(/\d+/)||[0])[0];if(have<need){console.error('Node '+process.versions.node+' is installed, but this project asks for '+p.engines.node+'. Install a newer Node.js, then run this file again.');process.exit(1)}"
if errorlevel 1 goto :pause_fail

rem --- 3. npm ----------------------------------------------------------------
where npm >nul 2>&1
if errorlevel 1 goto :no_npm

rem --- 4. The ports, before anything tries to bind them -----------------------
call :port_busy 3310
call :port_busy 3311

rem --- 5. Dependencies --------------------------------------------------------
rem The real question is not "does the folder exist": a half-finished install, a
rem deleted package, or a dependency added since the last install all leave the
rem folder in place. scripts/check-deps.mjs asks whether every declared
rem dependency, and every command this project runs, is actually there, and
rem names what is missing.
node "scripts\check-deps.mjs"
if errorlevel 1 (
  echo Installing dependencies with npm ci. The first run takes a while.
  call npm ci
  if errorlevel 1 goto :install_failed
  echo.
)

rem --- 6. Build, unless development ------------------------------------------
rem Production serves compiled output, so it cannot be skipped or taken on
rem trust: a stale build is a build of code that no longer exists. Rebuilding
rem takes about a minute, so it happens only when a source is newer than the
rem build rather than on every launch.
if /i not "%~1"=="--development" (
  node "scripts\check-build.mjs"
  if errorlevel 1 (
    echo Building. This takes about a minute.
    call npm run build
    if errorlevel 1 goto :build_failed
    call npm run build:web
    if errorlevel 1 goto :build_failed
    node "scripts\stamp-build.mjs"
    echo.
  )
)

rem --- 7. Start ---------------------------------------------------------------
echo Interface: http://127.0.0.1:3310
echo API:       http://127.0.0.1:3311
echo Ctrl+C stops both.
echo.
if /i "%~1"=="--development" (call npm run dev) else (call npm run serve)
if errorlevel 1 goto :start_failed
exit /b 0

rem --- Checks that failed -----------------------------------------------------
:no_node
echo.
echo Node.js was not found on PATH.
echo Install Node.js 22.12 or later from https://nodejs.org, reopen this
echo terminal so PATH is refreshed, then run this file again.
goto :pause_fail

:no_npm
echo.
echo npm was not found on PATH. It normally arrives with Node.js; if Node came
echo from a package manager, npm may be a separate install.
goto :pause_fail

:install_failed
echo.
echo Installing the dependencies failed. The lines above say why. The usual
echo causes are no network, or package-lock.json out of step with
echo package.json.
goto :pause_fail

:build_failed
echo.
echo The build failed. The lines above say why. Nothing was started.
goto :pause_fail

:start_failed
echo.
echo The platform stopped while starting. The lines above say why.
goto :pause_fail

:pause_fail
echo.
pause
exit /b 1

rem Reports a busy port without stopping: something else may legitimately hold
rem it, and this script does not own that decision. A warning is the useful part.
:port_busy
netstat -ano | findstr /R /C:":%~1 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo Warning: something is already listening on port %~1. The half that wants
  echo that port will fail. Close the other program, or change the port.
  echo.
)
exit /b 0