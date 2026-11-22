import { extname } from 'node:path';

export function sourceErrorObserverProbe(testModuleUrl: string): string {
    const engineUrl = new URL(`../packages/engine/engine.entry-point${extname(import.meta.url)}`, import.meta.url);
    const observerUrl = new URL(
        `../engine/execution-global-error-observer${extname(import.meta.url)}`,
        import.meta.url
    );
    return `
        import assert from 'node:assert/strict';
        const { createRoot, createTestPlan, execute } = await import(${JSON.stringify(engineUrl.href)});
        const { globalErrorObserverTestNode } = await import(${JSON.stringify(testModuleUrl)});
        const { createExecutionGlobalErrorObserver } = await import(${JSON.stringify(observerUrl.href)});
        const observer = createExecutionGlobalErrorObserver('in-process');
        try {
            const result = await observer.runBoundary(async () => execute(createTestPlan(createRoot({
                title: 'source error observer probe', annotations: {}, controls: {},
                children: [globalErrorObserverTestNode]
            }))));
            const failures = result.perTest.filter(test => test.verdict !== 'pass');
            assert.equal(result.summary.failed, 0, JSON.stringify(failures));
            assert.equal(result.summary.passed, 13);
            assert.deepEqual(result.runnerErrors, []);
        } finally {
            observer.stop();
        }
    `;
}
