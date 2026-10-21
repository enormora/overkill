import { execFile } from 'node:child_process';
import { createSuite, createTestCase } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import { strykerPersistenceScript } from '../run/stryker-persistence-scripts.test.ts';
import { runIfMain } from './direct-launcher.test.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] as const };

const packagedPersistenceScript = `
import {execFileSync} from 'node:child_process';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cwd=realpathSync(mkdtempSync(join(tmpdir(),'overkill-packaged-persistence-')));
try {
    const output=execFileSync(process.execPath,[
        '--input-type=module','--eval',${JSON.stringify(strykerPersistenceScript)},
        import.meta.resolve('@overkill-dev/stryker-runner'),
        import.meta.resolve('@overkill-dev/engine'),
        import.meta.resolve('@overkill-dev/run/config'),
        ${JSON.stringify(import.meta.resolve('@stryker-mutator/instrumenter'))},
        process.argv[1],'false','failures'
    ],{cwd,encoding:'utf8',stdio:'pipe'});
    process.stdout.write(output);
} finally {rmSync(cwd,{recursive:true,force:true});}
`;

async function executePackagedPersistence(processModel: string): Promise<string> {
    return await new Promise<string>(function executeScript(resolve, reject) {
        execFile(
            process.execPath,
            [ '--input-type=module', '--eval', packagedPersistenceScript, processModel ],
            { cwd: import.meta.dirname, timeout: 120_000 },
            function collectOutput(error, stdout, stderr) {
                if (error === null) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr, { cause: error }));
                }
            }
        );
    });
}

export const testNode = createSuite({
    ...metadata,
    title: 'packaged Stryker diagnostic persistence',
    children: [ 'in-process', 'supervised-process' ].map(function processModel(mode) {
        return createTestCase({
            ...metadata,
            title: mode,
            async body(scope) {
                scope.assert.equal(await executePackagedPersistence(mode), 'persistence passed\n');
                return scope.assert.collect();
            }
        });
    })
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
