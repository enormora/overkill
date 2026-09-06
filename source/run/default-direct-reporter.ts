import {
    isReporter,
    type Reporter
} from '../engine/reporter.ts';

export async function createDefaultDirectReporter(): Promise<Reporter> {
    const reporterModule = await import('@overkill-dev/reporter-line');

    if (
        !Object.hasOwn(reporterModule, 'createLineReporter') ||
        typeof reporterModule.createLineReporter !== 'function'
    ) {
        throw new TypeError('Default line reporter module is invalid.');
    }

    const reporter: unknown = Reflect.apply(reporterModule.createLineReporter, reporterModule, []);

    if (!isReporter(reporter)) {
        throw new TypeError('Default line reporter factory returned an invalid reporter.');
    }

    return reporter;
}
