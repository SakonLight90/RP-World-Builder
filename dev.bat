@echo off
rem Development start: the interface recompiles each page on request.
rem
rem Faster to start, and much slower to use. It is here for changing the code,
rem not for playing: on this project a page took 3121 ms in development and
rem 17 ms built, so a speed problem cannot be judged from this mode.
rem
rem The checks and the two-process handling live in start.bat, so there is one
rem place that knows how to start the platform and not two that can disagree.
call "%~dp0start.bat" --development