import type { Clock } from '@enormora/clock';

type ShutdownChild = {
    readonly closeTransport: () => void;
    readonly exitCode: number | null;
    readonly signalCode: string | null;
    readonly pid: number | undefined;
    readonly kill: (signal: 'SIGKILL') => unknown;
    readonly on: (event: 'close' | 'disconnect' | 'exit', listener: () => void) => unknown;
};
const shutdownStarts = new WeakMap<ShutdownChild, () => void>();
const shutdownMilliseconds = 1000;

export function startChildShutdown(child: ShutdownChild): void {
    shutdownStarts.get(child)?.();
}

function killLingeringChild(child: ShutdownChild): void {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
    }
}

function terminateChild(child: ShutdownChild): void {
    try {
        killLingeringChild(child);
    } catch {}
    try {
        child.closeTransport();
    } catch {}
}
export function observeChildShutdown(
    child: ShutdownChild,
    clock: Pick<Clock, 'clearTimeout' | 'setTimeout'>,
    timedOut: () => void,
    finished: () => void
): void {
    let timeout: ReturnType<Clock['setTimeout']> | null = null;
    let closed = false;

    function finish(): void {
        if (closed) {
            return;
        }

        closed = true;
        if (timeout !== null) {
            clock.clearTimeout(timeout);
        }
        shutdownStarts.delete(child);
        finished();
    }

    function start(): void {
        if (closed || timeout !== null) {
            return;
        }

        timeout = clock.setTimeout(function terminateLingeringChild() {
            timedOut();
            try {
                terminateChild(child);
            } finally {
                finish();
            }
        }, shutdownMilliseconds);
    }

    shutdownStarts.set(child, start);
    child.on('exit', start);
    child.on('disconnect', start);
    child.on('close', finish);
}
