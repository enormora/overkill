import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createClock } from '@enormora/clock';
import type { TestScope } from '../packages/test/test.entry-point.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import { createReporterDispatcher, type ReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createOrdinaryBaselineStore, type OrdinaryBaselineStore } from '../run/baseline-store.ts';
import type { OrdinaryBaselineChange, StoredOrdinaryBaseline } from '../run/baseline-record.ts';
import { runResultFactory } from './run-result-factory.ts';

function baseline(title: string): StoredOrdinaryBaseline {
    return {
        version: 1,
        adapter: 'output',
        profile: 'unit',
        subtype: 'content-snapshot',
        comparisonContext: {},
        work: createDefaultWorkId(createCaseId('output.test.ts', [], title, null)),
        payload: { kind: 'text', text: title }
    };
}
type PublicationFixture = {
    readonly store: OrdinaryBaselineStore;
    readonly dispatcher: ReporterDispatcher;
    readonly changes: readonly OrdinaryBaselineChange[];
    readonly result: RunResult;
};
export async function sessionFixture(scope: TestScope): Promise<PublicationFixture> {
    await mkdir('target', { recursive: true });
    const directory = await mkdtemp('target/baseline-publication-');
    scope.cleanup(async function () {
        await rm(directory, { recursive: true, force: true });
    });
    const store = await createOrdinaryBaselineStore({ directory, projectRoot: process.cwd(), maxBytes: 65_536 });
    const dispatcher = createReporterDispatcher({
        wallClock: createClock(),
        stdout: {
            writeLine() {
                return undefined;
            }
        },
        stderr: {
            writeLine() {
                return undefined;
            }
        }
    });
    const changes: readonly OrdinaryBaselineChange[] = [ { kind: 'create', baseline: baseline('first') }, {
        kind: 'create',
        baseline: baseline('second')
    } ];
    const result = runResultFactory.build({
        status: 'passed',
        planStatus: 'planned',
        perTest: [],
        summary: { planned: 0 }
    });
    return { store, dispatcher, changes, result };
}
