import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invalidRequest } from './run-errors.ts';
import type { RunCommand, RunMicrotestProfileConfig } from './run-types.ts';

function supervisedProcess(profile: RunMicrotestProfileConfig): boolean {
    return profile.execution.processModel === 'supervised-process';
}

function assertSupportedSupervisedEngine(command: RunCommand): void {
    if (command.engine.kind === 'instance') {
        invalidRequest('Instance engines are not supported with supervised-process execution. Use a module engine.');
    }
}

function modulePath(moduleUrl: string): string {
    try {
        return fileURLToPath(moduleUrl);
    } catch {
        invalidRequest('Supervised custom engine moduleUrl must be a file URL under cwd.');
    }

    throw new Error('Unreachable module URL validation state.');
}

function insideCwd(cwd: string, filePath: string): boolean {
    const relativeModulePath = path.relative(cwd, filePath);

    return !relativeModulePath.startsWith('..') && !path.isAbsolute(relativeModulePath);
}

function assertSupportedSupervisedModule(command: RunCommand): void {
    if (command.engine.kind !== 'module') {
        return;
    }

    if (!insideCwd(command.cwd, modulePath(command.engine.moduleUrl))) {
        invalidRequest('Supervised custom engine moduleUrl must be under cwd.');
    }
}

export function assertSupportedProcessEngine(command: RunCommand, profile: RunMicrotestProfileConfig): void {
    if (!supervisedProcess(profile)) {
        return;
    }

    assertSupportedSupervisedEngine(command);
    assertSupportedSupervisedModule(command);
}
