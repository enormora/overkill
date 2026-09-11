import type { AssertionRecorder } from './assertion-recorder.ts';
import { createRecordingAssertFacade } from './assertion-facade.ts';
import { createRecordingRequireFacade } from './require-assertion-facade.ts';
import type { ThrowingTestScope } from './test-node.ts';

export function createThrowingTestScope(recorder: AssertionRecorder, signal: AbortSignal): ThrowingTestScope {
    return {
        assert: createRecordingAssertFacade(
            {
                failContract(failure) {
                    return recorder.failContract(failure);
                },
                recordAssert(assertion) {
                    recorder.recordAssert(assertion);
                },
                recordPendingAssert() {
                    return recorder.recordPendingAssert();
                }
            },
            null
        ),
        require: createRecordingRequireFacade(
            {
                failContract(failure) {
                    return recorder.failContract(failure);
                },
                recordRequire(assertion) {
                    recorder.recordRequire(assertion);
                }
            },
            null
        ),
        signal
    };
}
