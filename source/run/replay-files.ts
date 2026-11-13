import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { currentReplay } from './replay-context.ts';
import type { ReplayRunRecord } from './replay-record-types.ts';
import type { DiscoveredRunFile } from './run-types.ts';
import { invalidRequest } from './run-errors.ts';

type ReplayFiles = {
    readonly projectRoot: string;
    readonly files: readonly [DiscoveredRunFile, ...(readonly DiscoveredRunFile[])];
};
async function retainedSourcePath(file: string): Promise<string> {
    try {
        return await realpath(file);
    } catch (error: unknown) {
        return invalidRequest(`Recorded source is unavailable: ${file}: ${String(error)}`);
    }
}
async function bindSource(projectRoot: string, file: string, fileSet: string | null): Promise<DiscoveredRunFile> {
    const filePath = await retainedSourcePath(path.resolve(projectRoot, file));
    const origin = path.relative(projectRoot, filePath);
    if (path.isAbsolute(origin) || origin === '..' || origin.startsWith(`..${path.sep}`)) {
        invalidRequest(`Recorded source escapes the replay project: ${file}`);
    }
    return { file, fileSet, href: pathToFileURL(filePath).href, path: filePath };
}
function emptyReplayFiles(projectRoot: string, record: ReplayRunRecord): ReplayFiles {
    const file = record.replayPlan.discoveredFiles[0]?.file ?? '';
    const filePath = path.resolve(projectRoot, file);
    return { projectRoot, files: [ { file, fileSet: null, href: pathToFileURL(filePath).href, path: filePath } ] };
}
async function bindRecordedSources(projectRoot: string, record: ReplayRunRecord): Promise<ReplayFiles> {
    const importedFamily = typeof record.replayProfile === 'object' && record.replayProfile !== null &&
        Reflect.get(record.replayProfile, 'kind') === 'family';
    const sources = importedFamily ? record.replayPlan.discoveredFiles : record.replayPlan.files;
    const files = await Promise.all(sources.map(async function bind(source) {
        const metadata = record.facts.cases.find(function matching(entry) {
            return entry.workId.case.file === source.file;
        });
        return await bindSource(projectRoot, source.file, metadata?.fileSet ?? null);
    }));
    const [ first, ...rest ] = files;
    if (first === undefined) {
        invalidRequest('Recorded run has no source modules.');
    }
    return { projectRoot, files: [ first, ...rest ] };
}

export async function recordedReplayFiles(cwd: string): Promise<ReplayFiles | null> {
    const replay = currentReplay();
    if (replay?.kind !== 'record') {
        return null;
    }
    const projectRoot = await realpath(cwd);
    if (replay.record.identities.length === 0) {
        return emptyReplayFiles(projectRoot, replay.record);
    }
    return await bindRecordedSources(projectRoot, replay.record);
}

export async function verifyWitnessSource(cwd: string, file: string): Promise<void> {
    await bindSource(await realpath(cwd), file, null);
}
