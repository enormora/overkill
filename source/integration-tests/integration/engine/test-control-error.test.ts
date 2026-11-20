import { type TestNode, table } from '@overkill-dev/test';

import { observeRule } from '../../../eslint-test/rule-observation.ts';
import {
    RequireFailedSignalError as SourceRequireFailedSignalError,
    TestContractSignalError as SourceTestContractSignalError
} from '../../../engine/assertion-recorder.ts';
import { isTestControlError } from '../../../engine/test-control-error.ts';

const failure = {
    kind: 'test-contract',
    code: 'no-assertions',
    actual: 0,
    expected: 'one',
    summary: 'No assertions.'
} as const;
const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const copiedModuleUrl = new URL(
    `../../../engine/assertion-recorder.${extension}?copy=control-signals`,
    import.meta.url
);
const copiedModule = copiedModuleUrl.href;

class RequireFailedSignalError extends Error {
    public constructor() {
        super('Unbranded requirement.');
        this.name = 'RequireFailedSignalError';
    }
}
class TestContractSignalError extends Error {
    public constructor() {
        super('Unbranded contract.');
        this.name = 'TestContractSignalError';
    }
}

async function copiedSignal(name: string): Promise<unknown> {
    const namespace: unknown = await import(copiedModule);
    if (typeof namespace !== 'object' || namespace === null) {
        throw new TypeError('Expected an assertion recorder module.');
    }
    const SignalError: unknown = Reflect.get(namespace, name);
    if (typeof SignalError !== 'function') {
        throw new TypeError('Expected an assertion signal constructor.');
    }
    return Reflect.construct(SignalError, name === 'TestContractSignalError' ? [ failure, undefined ] : []);
}

export const testNode: TestNode = table({
    title: 'assertion controls across module copies',
    cases: [
        { name: 'RequireFailedSignalError', unrelated: new RequireFailedSignalError() },
        { name: 'TestContractSignalError', unrelated: new TestContractSignalError() }
    ],
    caseTitle(scenario) {
        return scenario.name;
    },
    async test(scope) {
        const control = await copiedSignal(scope.parameters.name);
        scope.assert.false(
            control instanceof SourceRequireFailedSignalError || control instanceof SourceTestContractSignalError
        );
        scope.assert.true(isTestControlError(control));
        let captured: unknown = null;
        try {
            observeRule(function stopRule() {
                throw control;
            }, scope.signal);
        } catch (error: unknown) {
            captured = error;
        }
        scope.assert.equal(captured, control);
        scope.assert.false(
            isTestControlError(scope.parameters.unrelated)
        );
        return scope.assert.collect();
    }
});
