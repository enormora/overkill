import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type CoverageFixtureSource = {
    readonly file: string;
    readonly loaded: boolean;
    readonly source: string;
};

export type CoverageSourceFixture = {
    readonly coverageDirectory: string;
    readonly projectRoot: string;
    readonly rawDataDirectory: string;
};

async function createCoverageFixture(
    projectRoot: string,
    sources: readonly CoverageFixtureSource[]
): Promise<CoverageSourceFixture> {
    const rawDataDirectory = path.join(projectRoot, 'raw');

    await mkdir(rawDataDirectory);
    for (const source of sources) {
        const file = path.join(projectRoot, source.file);

        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, source.source);
    }
    await writeFile(
        path.join(rawDataDirectory, 'coverage-fixture.json'),
        JSON.stringify({
            result: sources
                .filter(function isLoaded(source) {
                    return source.loaded;
                })
                .map(function nativeEntry(source, index) {
                    return {
                        functions: [ {
                            functionName: '',
                            isBlockCoverage: true,
                            ranges: [ { count: 1, endOffset: source.source.length, startOffset: 0 } ]
                        } ],
                        scriptId: String(index),
                        url: pathToFileURL(path.join(projectRoot, source.file)).href
                    };
                })
        })
    );
    return { coverageDirectory: path.join(projectRoot, 'report'), projectRoot, rawDataDirectory };
}

export async function withCoverageSources(
    sources: readonly CoverageFixtureSource[],
    body: (fixture: CoverageSourceFixture) => Promise<void>
): Promise<void> {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'overkill-coverage-sources-'));

    try {
        await body(await createCoverageFixture(projectRoot, sources));
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
}
