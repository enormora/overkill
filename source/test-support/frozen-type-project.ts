import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';

export async function frozenTypeProject(scope: TestScope, files: Readonly<Record<string, string>>): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-frozen-'));
    scope.cleanup(async function removeProject() {
        await rm(directory, { recursive: true, force: true });
    });
    for (const [ name, text ] of Object.entries(files)) {
        await mkdir(dirname(join(directory, name)), { recursive: true });
        await writeFile(join(directory, name), text);
    }
    return directory;
}
