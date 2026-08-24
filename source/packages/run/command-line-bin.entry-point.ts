#!/usr/bin/env -S node --permission-audit
import { commandLineExitCodes } from '../../run/command-line-command.ts';

process.stderr.write('Overkill binary argument parsing is not implemented yet.\n');
process.exitCode = commandLineExitCodes.argumentOrConfig;
