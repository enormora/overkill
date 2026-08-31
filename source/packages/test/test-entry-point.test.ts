import { createSuite, createTestCase, runIfMain, type TestScope } from '@overkill-dev/engine';
import { createLineReporter } from '@overkill-dev/reporter-line';
import {
    createTestFacade,
    defineMacro,
    runIfMain as rootRunIfMain,
    suite,
    table,
    test
} from './test.entry-point.ts';

type PlaceholderExport = {
    readonly invoke: (...parameters: readonly unknown[]) => never;
    readonly name: string;
};

const placeholderExports: readonly PlaceholderExport[] = [
    { invoke: createTestFacade, name: 'createTestFacade' },
    { invoke: defineMacro, name: 'defineMacro' },
    { invoke: rootRunIfMain, name: 'runIfMain' },
    { invoke: suite, name: 'suite' },
    { invoke: table, name: 'table' },
    { invoke: test, name: 'test' }
];

export const testSuite = createSuite({
    name: 'source/packages/test/test-entry-point.test.ts',
    metadata: {},
    children: [
        createTestCase({
            name: '@overkill-dev/test root authoring placeholders throw unavailable errors',
            metadata: {},
            body(scope: TestScope) {
                for (const placeholderExport of placeholderExports) {
                    scope.assert.throws(function invokePlaceholder() {
                        placeholderExport.invoke('ignored');
                    }, {
                        message: [
                            `The @overkill-dev/test ${placeholderExport.name}() authoring API`,
                            'is not implemented yet.'
                        ]
                            .join(' ')
                    });
                }

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createLineReporter() ] });
