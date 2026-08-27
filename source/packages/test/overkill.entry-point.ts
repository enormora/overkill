#!/usr/bin/env -S node --permission-audit
import type { CommandLineRunner } from '../run/command-line.entry-point.ts';
import { runOverkillCommandLine } from './command-line-runner.ts';

const commandArgumentStartIndex = 2;

await runOverkillCommandLine({
    arguments: process.argv.slice(commandArgumentStartIndex),
    applyExitCode(exitCode) {
        process.exitCode = exitCode;
    },
    cwd: process.cwd(),
    async loadRunner(): Promise<CommandLineRunner> {
        const runnerModule = await import('../run/command-line.entry-point.ts');

        return runnerModule.commandLineRunner;
    },
    stderr: process.stderr,
    stdout: process.stdout
});
