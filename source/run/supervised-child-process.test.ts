import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createStoredRunValue,
    createSupervisedRunState,
    type StoredRunValue,
    type SupervisedRunState
} from './supervised-run-state.ts';
import {
    createSupervisedChildProcessStarter,
    observeSupervisedChildOutput,
    runSupervisedChildProcessEntryPoint,
    type SupervisedChildProcess,
    type SupervisedChildProcessStarter,
    type SupervisedChildProcessStarterDependencies
} from './supervised-child-process.ts';

type ForkCall = {
    readonly childArguments: readonly string[];
    readonly modulePath: string;
    readonly options: Parameters<SupervisedChildProcessStarterDependencies['fork']>[2];
};

type OutputRecord = {
    readonly emit: (text: string) => void;
    readonly output: NonNullable<SupervisedChildProcess['stderr']>;
};

type StarterFixture = {
    readonly child: SupervisedChildProcess;
    readonly forkCalls: () => readonly ForkCall[];
    readonly startSupervisedChild: SupervisedChildProcessStarter;
};

function createOutputRecord(): OutputRecord {
    let listener: (chunk: Uint8Array) => void = function ignoreOutput() {
        return undefined;
    };

    return {
        emit(text) {
            listener(Buffer.from(text));
        },
        output: {
            on(_event, nextListener) {
                listener = nextListener;

                return undefined;
            }
        }
    };
}

function createChildProcess(
    stdout: SupervisedChildProcess['stdout'],
    stderr: SupervisedChildProcess['stderr']
): SupervisedChildProcess {
    return {
        exitCode: null,
        kill() {
            return true;
        },
        on() {
            return undefined;
        },
        pid: 123,
        send() {
            return undefined;
        },
        signalCode: null,
        stderr,
        stdout
    };
}

function createStarterFixture(): StarterFixture {
    const child = createChildProcess(null, null);
    const forkCalls: ForkCall[] = [];
    const realpaths = new Map([
        [ '/project/sub', '/real/project/sub' ],
        [ '/project/node_modules', '/real/project/node_modules' ],
        [ '/package/root', '/real/package/root' ],
        [ '/package/root/node_modules', '/real/package/root/node_modules' ],
        [ '/node_modules', '/real/shared/node_modules' ]
    ]);

    return {
        child,
        forkCalls() {
            return forkCalls;
        },
        startSupervisedChild: createSupervisedChildProcessStarter({
            childPackageRoot: '/package/root',
            childProcessEntryPoint: '/package/root/source/run/supervised-child-process.entry-point.ts',
            fork(modulePath, childArguments, options) {
                forkCalls.push({ childArguments, modulePath, options });

                return child;
            },
            async realpath(path) {
                const realpath = realpaths.get(path);

                if (realpath === undefined) {
                    throw new Error(`Missing realpath fixture: ${path}`);
                }

                return realpath;
            }
        })
    };
}

function observeRestrictedOutput(
    stdout: OutputRecord,
    stderr: OutputRecord,
    state: SupervisedRunState,
    terminalFailure: StoredRunValue<boolean>
): void {
    observeSupervisedChildOutput({
        capabilityRestrictions: { mode: 'enabled' },
        capture: 'buffered',
        child: createChildProcess(stdout.output, stderr.output),
        dependencies: {
            liveOutput: {
                stderr: {
                    write() {
                        return undefined;
                    }
                },
                stdout: {
                    write() {
                        return undefined;
                    }
                }
            },
            wallClock: { currentTimestampInMilliseconds: 123 }
        },
        state,
        terminalFailure
    });
}

function emitRestrictedOutput(stdout: OutputRecord, stderr: OutputRecord): void {
    stdout.emit('');
    stderr.emit('');
    stdout.emit('raw stdout');
    stderr.emit(
        [
            '[--trace-env] set "API_KEY"',
            '----- JavaScript stack trace -----',
            '1: frame',
            '[--trace-env] delete "TOKEN"',
            'raw stderr',
            ''
        ]
            .join('\n')
    );
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-child-process.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'startSupervisedChild() sanitizes the child environment when restrictions are disabled',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createStarterFixture();
                const child = await fixture.startSupervisedChild({
                    capabilityRestrictions: { mode: 'disabled' },
                    cwd: '/project/sub',
                    environmentVariables: {
                        KEEP: 'yes',
                        NODE_CHANNEL_FD: '1',
                        NODE_CONFIG: 'config',
                        NODE_OPTIONS: '--inspect',
                        NODE_UNIQUE_ID: '2',
                        NODE_V8_COVERAGE: '/coverage',
                        OMIT: undefined
                    }
                });
                const [ forkCall ] = fixture.forkCalls();

                scope.assert.equal(Object.is(child, fixture.child), true);
                scope.require.defined(forkCall);
                scope.assert.equal(
                    forkCall.modulePath,
                    '/package/root/source/run/supervised-child-process.entry-point.ts'
                );
                scope.assert.deepEqual(forkCall.childArguments, [ '--overkill-supervised-child' ]);
                scope.assert.deepEqual(forkCall.options, {
                    cwd: '/project/sub',
                    env: { KEEP: 'yes' },
                    execArgv: [],
                    stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ]
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'startSupervisedChild() allows canonical read roots when restrictions are enabled',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const fixture = createStarterFixture();

                await fixture.startSupervisedChild({
                    capabilityRestrictions: { mode: 'enabled' },
                    cwd: '/project/sub',
                    environmentVariables: {}
                });

                const [ forkCall ] = fixture.forkCalls();
                scope.require.defined(forkCall);
                scope.assert.deepEqual(forkCall.options.execArgv, [
                    '--permission',
                    '--trace-env',
                    '--trace-env-js-stack',
                    '--allow-fs-read=/project/sub',
                    '--allow-fs-read=/real/project/sub',
                    '--allow-fs-read=/package/root',
                    '--allow-fs-read=/real/package/root',
                    '--allow-fs-read=/project/node_modules',
                    '--allow-fs-read=/real/project/node_modules',
                    '--allow-fs-read=/node_modules',
                    '--allow-fs-read=/real/shared/node_modules',
                    '--allow-fs-read=/package/root/node_modules',
                    '--allow-fs-read=/real/package/root/node_modules'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runSupervisedChildProcessEntryPoint() loads only supervised child invocations',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                let loadCount = 0;
                const loadSupervisedChild = async function loadSupervisedChild(): Promise<void> {
                    loadCount += 1;
                };

                await runSupervisedChildProcessEntryPoint([ 'plain' ], loadSupervisedChild);
                await runSupervisedChildProcessEntryPoint([
                    'plain',
                    '--overkill-supervised-child'
                ], loadSupervisedChild);

                scope.assert.equal(loadCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'observeSupervisedChildOutput() reports restricted raw and environment output',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const stdout = createOutputRecord();
                const stderr = createOutputRecord();
                const state = createSupervisedRunState();
                const terminalFailure = createStoredRunValue(false);

                observeRestrictedOutput(stdout, stderr, state, terminalFailure);
                emitRestrictedOutput(stdout, stderr);

                scope.assert.equal(terminalFailure.read(), true);
                scope.assert.deepEqual(
                    state.runnerErrors().map(function toMessage(error) {
                        return error.message;
                    }),
                    [
                        'Runtime policy violation: supervised child wrote to stdout.',
                        'Runtime policy violation: process.env value was set: API_KEY.',
                        'Runtime policy violation: process.env value was deleted: TOKEN.',
                        'Runtime policy violation: supervised child wrote to stderr.'
                    ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
