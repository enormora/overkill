import { AsyncLocalStorage } from 'node:async_hooks';

export type ReporterConsoleMethod = 'debug' | 'error' | 'info' | 'log' | 'warn';

type ReporterOutputScope = {
    readonly allowedConsoleMethods: readonly ReporterConsoleMethod[];
    readonly consoleViolationMessage: (method: ReporterConsoleMethod) => string;
    readonly addViolation: (message: string) => void;
    readonly violations: () => readonly string[];
};

type ReporterOutputScopeResult<Value> = {
    readonly result: Value;
    readonly violations: readonly string[];
};

const consoleMethodByDiagnosticChannel: Readonly<Record<string, ReporterConsoleMethod>> = {
    'console.debug': 'debug',
    'console.error': 'error',
    'console.info': 'info',
    'console.log': 'log',
    'console.warn': 'warn'
};

function consoleMethodFromDiagnosticChannel(channelName: string): ReporterConsoleMethod | null {
    return consoleMethodByDiagnosticChannel[channelName] ?? null;
}

const reporterOutputScopeStorage = new AsyncLocalStorage<ReporterOutputScope>();

export function recordReporterConsoleDiagnostic(channelName: string): boolean {
    const scope = reporterOutputScopeStorage.getStore();
    const method = consoleMethodFromDiagnosticChannel(channelName);

    if (scope === undefined || method === null) {
        return false;
    }

    if (!scope.allowedConsoleMethods.includes(method)) {
        scope.addViolation(scope.consoleViolationMessage(method));
    }

    return true;
}

export async function runWithReporterOutputScope<Value>(
    allowedConsoleMethods: readonly ReporterConsoleMethod[],
    consoleViolationMessage: (method: ReporterConsoleMethod) => string,
    run: () => Promise<Value> | Value
): Promise<ReporterOutputScopeResult<Value>> {
    const violations: string[] = [];
    const scope: ReporterOutputScope = {
        allowedConsoleMethods,
        consoleViolationMessage,
        addViolation(message) {
            violations.push(message);
        },
        violations() {
            return violations;
        }
    };
    const result = await reporterOutputScopeStorage.run(scope, run);

    return {
        result,
        violations: scope.violations()
    };
}

export function runWithReporterOutputScopeNow<Value>(
    allowedConsoleMethods: readonly ReporterConsoleMethod[],
    consoleViolationMessage: (method: ReporterConsoleMethod) => string,
    run: () => Value
): ReporterOutputScopeResult<Value> {
    const violations: string[] = [];
    const scope: ReporterOutputScope = {
        allowedConsoleMethods,
        consoleViolationMessage,
        addViolation(message) {
            violations.push(message);
        },
        violations() {
            return violations;
        }
    };
    const result = reporterOutputScopeStorage.run(scope, run);

    return {
        result,
        violations: scope.violations()
    };
}
