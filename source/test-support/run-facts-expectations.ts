import { serializeValue } from '../compare/serialized-value.ts';
import type { RunCaseFacts, RunFacts } from '../run/run-types.ts';

export const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';

export function expectedRunEnvironment(): RunFacts['environment'] {
    return {
        node: {
            arch: 'x64',
            platform: 'linux',
            version: '26.1.1'
        },
        projectRoot: process.cwd(),
        runtimeStateDir: '.overkill'
    };
}

function expectedPassingFixtureAnnotations(): unknown {
    return {
        ownership: [],
        tags: [ 'fast' ]
    };
}

function expectedPassingFixtureControls(): unknown {
    return {
        capture: null,
        duplicateExecution: null,
        timeoutMilliseconds: null
    };
}

function expectedPassingFixtureCaseId(): RunCaseFacts['id'] {
    return { file: passingFixturePath, title: 'passes', params: null, suite: [ 'fixture' ] };
}

export function expectedPassingFixtureCaseFact(): RunCaseFacts {
    const id = expectedPassingFixtureCaseId();

    return {
        annotations: serializeValue(expectedPassingFixtureAnnotations()),
        controls: serializeValue(expectedPassingFixtureControls()),
        propertyPolicy: null,
        fileSet: null,
        id,
        workId: { familyVariant: null, case: expectedPassingFixtureCaseId(), runtimes: [], workload: null }
    };
}

export function expectedPassingFixtureLiveCaseFact(): RunCaseFacts {
    const id = expectedPassingFixtureCaseId();

    return {
        annotations: serializeValue(expectedPassingFixtureAnnotations()),
        controls: serializeValue(expectedPassingFixtureControls()),
        propertyPolicy: null,
        fileSet: null,
        id,
        workId: { familyVariant: null, case: id, runtimes: [], workload: null }
    };
}
