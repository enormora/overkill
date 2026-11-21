import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import {
    composeRuntimes,
    createResourcesModule,
    defineResource,
    defineRuntime,
    resolvedRuntimeScenarioOwners,
    type ComposedRuntimeGraph,
    type RuntimeDefinition
} from './resources.ts';
import { startRuntime } from './runtime-lifecycle.ts';

type Database = {
    readonly query: (sql: string) => readonly string[];
};

type Server = {
    readonly results: readonly string[];
};

function createDatabase(): Database {
    return {
        query(sql: string) {
            return [ sql ];
        }
    };
}

const databaseResource = defineResource({
    name: 'database',
    scope: 'per-case',
    requirements: [],
    acquire: createDatabase,
    dispose: null
});
const serverResource = defineResource({
    name: 'server',
    scope: 'per-case',
    requirements: [],
    dependencies: { database: databaseResource },
    acquire(context): Server {
        return {
            results: context.dependencies.database.query('server started')
        };
    },
    dispose: null
});
const apiRuntime = defineRuntime({
    name: 'api',
    dimensions: {},
    resources: { database: databaseResource },
    requirements: []
});
const serverRuntime = defineRuntime({
    name: 'server',
    dimensions: {},
    resources: { server: serverResource },
    requirements: []
});
const { composeRuntimeContext } = createResourcesModule({
    async createTemporaryDirectory(pathPrefix) {
        return `${pathPrefix}created`;
    },
    async removeDirectory() {
        return undefined;
    },
    temporaryDirectoryPathPrefix: '/virtual/overkill-temporary-directory-'
});

const brandedDescriptorChecks = (
    check: CompositeCheckBuilder<'assert'>,
    descriptor: unknown
): CompositeAssertionReturn<'assert'> => {
    if (typeof descriptor !== 'object' || descriptor === null) {
        throw new Error('Expected object descriptor.');
    }
    const brandSymbols = Object.getOwnPropertySymbols(descriptor);
    const brandSymbol = brandSymbols[0];
    if (brandSymbol === undefined) {
        throw new Error('Expected descriptor brand.');
    }
    return check.group([
        check.equal(brandSymbols.length, 1),
        check.equal(Reflect.get(descriptor, brandSymbol), true)
    ]);
};

function composedRuntimePair(): ComposedRuntimeGraph<readonly [typeof apiRuntime, typeof serverRuntime]> {
    return composeRuntimes(apiRuntime, serverRuntime);
}

function nestedRuntimePair(): ComposedRuntimeGraph<readonly [typeof apiRuntime | typeof serverRuntime]> {
    return composeRuntimes(composeRuntimes(apiRuntime, serverRuntime));
}

const assertRuntimeGraphComposition = defineCompositeAssertion({
    name: 'runtime graph composition',
    assert(check) {
        const composed = composedRuntimePair();
        const database = createDatabase();
        const server = { results: [ 'ready' ] };
        const context = composeRuntimeContext({ base: 'scope' }, composed, {
            api: { database },
            server: { server }
        });
        return check.group([
            brandedDescriptorChecks(check.annotated('branded descriptor'), composed),
            check.equal(composed.kind, 'composed-runtimes'),
            check.deepEqual(
                composed.runtimes.map(function runtimeName(runtime) {
                    return runtime.name;
                }),
                [ 'api', 'server' ]
            ),
            check.equal(Object.isFrozen(composed), true),
            check.equal(context.runtimes.api.database, database),
            check.equal(context.runtimes.server.server, server)
        ]);
    }
});

const assertNestedRuntimeGraphComposition = defineCompositeAssertion({
    name: 'nested runtime graph composition',
    assert(check) {
        const composed = nestedRuntimePair();
        return check.group([ check.deepEqual(
            composed.runtimes.map(function runtimeName(runtime) {
                return runtime.name;
            }),
            [ 'api', 'server' ]
        ) ]);
    }
});

const assertRuntimeGraphContextValidation = defineCompositeAssertion({
    name: 'runtime graph context validation',
    assert(check) {
        const composed = composedRuntimePair();
        return check.group([ check.throws(function composeIncompleteRuntimeContext() {
            Reflect.apply(composeRuntimeContext, undefined, [
                { base: 'scope' },
                composed,
                { api: { database: createDatabase() } }
            ]);
        }, { message: 'Runtime scope "server" is missing.' }) ]);
    }
});

const assertRuntimeGraphCompositionRejectsInvalidInput = defineCompositeAssertion({
    name: 'runtime graph composition rejects invalid input',
    assert(check) {
        const duplicateApiRuntime = defineRuntime({
            name: 'api',
            dimensions: {},
            resources: { database: databaseResource },
            requirements: []
        });
        const duplicateRuntime = defineRuntime({
            name: 'api',
            dimensions: {},
            resources: { server: serverResource },
            requirements: []
        });
        return check.group([
            check.throws(function rejectEmptyComposition() {
                Reflect.apply(composeRuntimes, undefined, []);
            }, { message: 'composeRuntimes() requires at least one runtime graph.' }),
            check.throws(function rejectDuplicateRuntimeNames() {
                Reflect.apply(composeRuntimes, undefined, [ duplicateApiRuntime, duplicateRuntime ]);
            }, { message: 'Runtime scope "api" is attached multiple times.' })
        ]);
    }
});

type ScenarioEventLog = {
    readonly add: (event: string) => void;
    readonly values: () => readonly string[];
};

function createScenarioEventLog(): ScenarioEventLog {
    const events: string[] = [];

    return {
        add(event) {
            events.push(event);
        },
        values() {
            return events;
        }
    };
}

function nestedScenarioRuntime(events: ScenarioEventLog): RuntimeDefinition {
    const database = defineResource({
        name: 'scenario-database',
        scope: 'per-case',
        requirements: [],
        scenarios: {
            database: {
                default: 'populated',
                timing: 'acquire',
                values: [ 'populated', 'empty' ]
            }
        },
        acquire(context) {
            events.add(`acquire:database:${context.scenarios.database}`);

            return context.scenarios.database;
        },
        dispose(_handle, context) {
            events.add(`dispose:database:${context.scenarios.database}`);
        }
    });
    const server = defineResource({
        name: 'scenario-server',
        scope: 'per-case',
        requirements: [],
        dependencies: { database },
        scenarios: {
            api: {
                default: 'healthy',
                timing: 'request-routed',
                values: [ 'healthy', 'outage' ]
            }
        },
        acquire(context): string {
            events.add('acquire:api');

            return context.dependencies.database;
        },
        dispose() {
            events.add('dispose:api');
        },
        exposeHandle(handle, context) {
            events.add(`expose:api:${context.scenarios.api}`);

            return `${handle}:${context.scenarios.api}`;
        }
    });
    const runtime = defineRuntime({
        name: 'scenario-api',
        dimensions: {},
        resources: { server },
        requirements: []
    });

    return runtime.scenario({ api: 'outage' }).scenario({ database: 'empty' });
}

export const testNode = suite('Runtime composition', [
    test('composeRuntimes creates composed runtime graphs and scopes', function (scope) {
        scope.assert(assertRuntimeGraphComposition);
        scope.assert(assertNestedRuntimeGraphComposition);
        scope.assert(assertRuntimeGraphContextValidation);
        scope.assert(assertRuntimeGraphCompositionRejectsInvalidInput);

        return scope.assert.collect();
    }),
    suite('runtime scenarios reach nested resource lifecycle contexts', [
        test('scenario bindings reach nested owners', async (scope) => {
            const events = createScenarioEventLog();
            const bound = nestedScenarioRuntime(events);
            const owners = resolvedRuntimeScenarioOwners(bound);
            const controller = new AbortController();
            const session = await startRuntime({ runtime: bound, signal: controller.signal });

            scope.assert.equal(owners.get('api')?.path.join('.'), 'server');
            scope.assert.equal(owners.get('database')?.path.join('.'), 'server.database');
            scope.assert.equal(session.context.server, 'empty:outage');

            await session.disposeOnce({ signal: controller.signal });

            scope.assert.deepEqual(events.values(), [
                'acquire:database:empty',
                'acquire:api',
                'expose:api:outage',
                'dispose:api',
                'dispose:database:empty'
            ]);

            return scope.assert.collect();
        }),
        test('scenario composition validation', (scope) => {
            const resource = defineResource({
                name: 'scenario-owner',
                scope: 'per-case',
                requirements: [],
                scenarios: {
                    mode: { default: 'default', timing: 'acquire', values: [ 'default', 'alternate' ] }
                },
                acquire(context) {
                    return context.scenarios.mode;
                },
                dispose: null
            });
            const first = defineRuntime({ name: 'first', dimensions: {}, resources: { resource }, requirements: [] });
            const second = defineRuntime({ name: 'second', dimensions: {}, resources: { resource }, requirements: [] });
            const otherResource = defineResource({
                name: 'other-scenario-owner',
                scope: 'per-case',
                requirements: [],
                scenarios: {
                    mode: { default: 'default', timing: 'acquire', values: [ 'default', 'alternate' ] }
                },
                acquire(context) {
                    return context.scenarios.mode;
                },
                dispose: null
            });

            scope.assert.equal(resolvedRuntimeScenarioOwners({} as RuntimeDefinition).size, 0);
            scope.assert.equal(
                first.scenario({ mode: 'alternate' }).scenario({}).scenario({ mode: 'default' }).scenarios.mode.default,
                'default'
            );
            scope.assert.throws(function rejectUnknownScenarioSlot() {
                Reflect.apply(first.scenario, undefined, [ { missing: 'value' } ]);
            }, { message: 'Runtime scenario slot "missing" is not declared.' });
            scope.assert.throws(function rejectUnknownScenarioValue() {
                Reflect.apply(first.scenario, undefined, [ { mode: 'missing' } ]);
            }, { message: 'Runtime scenario slot "mode" does not declare value "missing".' });
            scope.assert.throws(function rejectMultipleScenarioOwners() {
                defineRuntime({
                    name: 'multiple-owners',
                    dimensions: {},
                    resources: { otherResource, resource },
                    requirements: []
                });
            }, { message: 'Scenario slot "mode" is declared by multiple resources.' });
            scope.assert.throws(function rejectDuplicateComposedScenarioSlot() {
                composeRuntimes(first, second);
            }, { message: 'Scenario slot "mode" is attached multiple times.' });

            return scope.assert.collect();
        })
    ])
]);
