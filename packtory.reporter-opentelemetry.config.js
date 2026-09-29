import path from 'node:path';

export function reporterOpenTelemetryPackage(projectFolder, packageMetadata) {
    return {
        name: '@overkill-dev/reporter-opentelemetry',
        bundlePeerDependencies: [ '@overkill-dev/engine' ],
        roots: {
            main: {
                js: 'packages/reporter-opentelemetry/reporter-opentelemetry.entry-point.js',
                declarationFile: 'packages/reporter-opentelemetry/reporter-opentelemetry.entry-point.d.ts'
            }
        },
        additionalFiles: [ {
            sourceFilePath: path.join(projectFolder, 'source/packages/reporter-opentelemetry/readme.md'),
            targetFilePath: 'readme.md'
        } ],
        additionalPackageJsonAttributes: {
            ...packageMetadata,
            description: 'OTLP JSON file reporter for Overkill timing data.'
        }
    };
}
