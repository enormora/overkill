import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TestScope } from '@overkill-dev/test';

const fixtureRoot = new URL('../fixtures/', import.meta.url);
const engineModule = new URL('../../../packages/engine/engine.entry-point.ts', import.meta.url);

export async function createCoverageCaseProject(
    cleanup: TestScope['cleanup'],
    caseFile: string,
    sourceFile: string
): Promise<string> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp(resolve('target/coverage-case-'));
    cleanup(async function removeProject() {
        await rm(directory, { recursive: true, force: true });
    });
    const source = await readFile(new URL(caseFile, fixtureRoot), 'utf8');
    const test = source.replace("'../../../packages/engine/engine.entry-point.ts'", function engineImport() {
        return JSON.stringify(engineModule.href);
    });
    await Promise.all([
        copyFile(new URL(sourceFile, fixtureRoot), join(directory, sourceFile)),
        writeFile(join(directory, caseFile), test)
    ]);
    return directory;
}
