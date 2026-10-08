import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProfileConfig } from '../config/types.ts';
import { invalidRequest } from './run-errors.ts';
import type { RunCommand } from './run-types.ts';

function separateRuntime(profile: TestProfileConfig): boolean {
    return profile.execution.processModel !== 'in-process';
}

function processModelLabel(profile: TestProfileConfig): string {
    return profile.execution.processModel;
}

function customEngineLabel(profile: TestProfileConfig): string {
    return profile.execution.processModel === 'supervised-process' ? 'Supervised' : profile.execution.processModel;
}

function assertSupportedSeparateRuntimeEngine(command: RunCommand, profile: TestProfileConfig): void {
    if (command.engine.kind === 'instance') {
        invalidRequest(
            `Instance engines are not supported with ${processModelLabel(profile)} execution. Use a module engine.`
        );
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

function assertSupportedSeparateRuntimeModule(command: RunCommand, profile: TestProfileConfig): void {
    if (command.engine.kind !== 'module') {
        return;
    }

    if (!insideCwd(command.cwd, modulePath(command.engine.moduleUrl))) {
        invalidRequest(`${customEngineLabel(profile)} custom engine moduleUrl must be under cwd.`);
    }
}

export function assertSupportedProcessEngine(command: RunCommand, profile: TestProfileConfig): void {
    if (!separateRuntime(profile)) {
        return;
    }

    assertSupportedSeparateRuntimeEngine(command, profile);
    assertSupportedSeparateRuntimeModule(command, profile);
}
