import type { TestScope } from '@overkill-dev/engine';

export function assertResourcesPackageRootExport(
    scope: TestScope,
    packageExports: Readonly<Record<string, unknown>>
): void {
    scope.assert.deepEqual(packageExports['.'], {
        import: './packages/resources/resources.entry-point.js',
        types: './packages/resources/resources.entry-point.d.ts'
    });
}

export function assertRunConfigSubpathExport(
    scope: TestScope,
    packageExports: Readonly<Record<string, unknown>>
): void {
    scope.assert.deepEqual(packageExports['./config'], {
        import: './packages/run/config.entry-point.js',
        types: './packages/run/config.entry-point.d.ts'
    });
}

export function assertTestStandardSubpathExports(
    scope: TestScope,
    packageExports: Readonly<Record<string, unknown>>
): void {
    scope.assert.deepEqual(packageExports['./config'], {
        import: './packages/test/config.entry-point.js',
        types: './packages/test/config.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./reporters'], {
        import: './packages/test/reporters.entry-point.js',
        types: './packages/test/reporters.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./assert'], {
        import: './packages/test/assert.entry-point.js',
        types: './packages/test/assert.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./bench'], {
        import: './packages/test/bench.entry-point.js',
        types: './packages/test/bench.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./compatibility'], {
        import: './packages/test/compatibility.entry-point.js',
        types: './packages/test/compatibility.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./resources'], {
        import: './packages/test/resources.entry-point.js',
        types: './packages/test/resources.entry-point.d.ts'
    });
    scope.assert.deepEqual(packageExports['./baselines'], {
        import: './packages/test/baselines.entry-point.js',
        types: './packages/test/baselines.entry-point.d.ts'
    });
}
