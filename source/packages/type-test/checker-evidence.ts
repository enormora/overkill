import { resolve } from 'node:path';
import { ProjectConfigKind, type Event as CheckerEvent } from 'tstyche/api';
import type { ReadonlyDeep } from 'type-fest';

function verifyProject(event: ReadonlyDeep<CheckerEvent>, path: string, version: string): boolean {
    if (event[0] !== 'project:uses') {
        return false;
    }
    const { projectConfig, compilerVersion } = event[1];
    if (
        projectConfig.kind !== ProjectConfigKind.Provided ||
        resolve(projectConfig.specifier) !== path || compilerVersion !== version
    ) {
        throw new Error('Unexpected checker project or compiler; baseline fallback is forbidden.', { cause: event });
    }
    return true;
}
function rejectSetupError(event: ReadonlyDeep<CheckerEvent>): void {
    if (event[0] === 'store:error' || event[0] === 'project:error') {
        throw new Error('Checker setup failed.', { cause: event });
    }
}
function completedFiles(
    events: readonly ReadonlyDeep<CheckerEvent>[],
    path: string,
    version: string
): ReadonlySet<string> {
    let projectSeen = false;
    const completed = new Set<string>();
    for (const event of events) {
        projectSeen = verifyProject(event, path, version) || projectSeen;
        rejectSetupError(event);
        if (event[0] === 'file:end') {
            if (!projectSeen) {
                throw new Error('Missing checker project evidence.');
            }
            completed.add(resolve(event[1].result.file.path));
        }
    }
    return completed;
}
export function verifyCheckerEvidence(
    events: readonly ReadonlyDeep<CheckerEvent>[],
    projectPath: string,
    version: string,
    files: readonly string[]
): void {
    const completed = completedFiles(events, projectPath, version);
    if (
        completed.size === 0 || files.some(function missing(file) {
            return !completed.has(file);
        })
    ) {
        throw new Error('Missing checker project or file execution evidence.');
    }
}
