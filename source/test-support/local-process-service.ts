import { EventEmitter } from 'node:events';
import { createStoredValue } from '../stored-value.ts';
import { resourceAttachments } from '../attachments/attachment-context.ts';
import type { TestScope } from '../packages/test/test.entry-point.ts';
import type { EmptyResourceDependencies } from '../resources/resources.ts';
import type { LocalServiceCreationContext } from '../resources/local-service-resource.ts';
import {
    createLocalProcessServiceDefinition,
    type LocalProcessDefinition,
    type LocalProcessServiceResourceInput,
    type LocalProcessCommand,
    type LocalProcessSignal,
    type LocalProcessChild
} from '../resources/local-process-service-resource.ts';

export type ProcessConsumer = { readonly endpoint: string; };
type ProcessInput = LocalProcessServiceResourceInput<'process', ProcessConsumer, 'per-case', EmptyResourceDependencies>;
type ShutdownBehavior = 'forced' | 'graceful' | 'throws';
type ReadinessBehavior = 'error' | 'exit' | 'failed' | 'ready';
type LocalProcessFixture = {
    readonly definition: LocalProcessDefinition<'process', ProcessConsumer, 'per-case', EmptyResourceDependencies>;
    readonly context: LocalServiceCreationContext;
    readonly input: ProcessInput;
    readonly child: LocalProcessChild;
    readonly commands: readonly LocalProcessCommand[];
    readonly signals: readonly LocalProcessSignal[];
    readonly waits: readonly { readonly milliseconds: number; readonly signal: AbortSignal; }[];
    readonly exit: (code: number, signal: string | null) => void;
};
const graceMilliseconds = 50;
export function localProcessService(
    scope: TestScope,
    shutdown: ShutdownBehavior,
    readiness: ReadinessBehavior
): LocalProcessFixture {
    const events = new EventEmitter();
    const status = createStoredValue<{ readonly code: number | null; readonly signal: string | null; }>({
        code: null,
        signal: null
    });
    const signals: LocalProcessSignal[] = [];
    const commands: LocalProcessCommand[] = [];
    const waits: { readonly milliseconds: number; readonly signal: AbortSignal; }[] = [];
    function exit(code: number, signal: string | null): void {
        status.write({ code, signal });
        events.emit('exit', code, signal);
        events.emit('close', code, signal);
    }
    const child: LocalProcessChild = {
        get exitCode() {
            return status.read().code;
        },
        get signalCode() {
            return status.read().signal;
        },
        once: events.once.bind(events),
        kill(signal) {
            signals.push(signal);
            if (shutdown === 'throws') {
                throw new Error('Signal failed.');
            }
            if (shutdown === 'graceful' || signal === 'SIGKILL') {
                exit(0, signal);
            }
            return true;
        }
    };
    scope.cleanup(function () {
        exit(0, null);
    });
    const input: ProcessInput = {
        name: 'process',
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        address: { kind: 'loopback', port: 0 },
        outputBufferBytes: 4096,
        shutdown: { gracefulSignal: 'SIGTERM', forceSignal: 'SIGKILL', graceMilliseconds },
        command() {
            return {
                command: 'service',
                arguments: [ 'start' ],
                environment: { MODE: 'test' },
                workingDirectory: '/project'
            };
        },
        async ready() {
            if (readiness === 'failed') {
                throw new Error('Readiness failed.');
            }
            if (readiness === 'ready') {
                return { endpoint: 'ready' };
            }
            const completion = Promise.withResolvers<ProcessConsumer>();
            queueMicrotask(function () {
                if (readiness === 'error') {
                    events.emit('error', new Error('Process failed.'));
                }
                exit(1, null);
                queueMicrotask(function () {
                    completion.resolve({ endpoint: 'too late' });
                });
            });
            return completion.promise;
        }
    };
    return {
        child,
        input,
        commands,
        signals,
        waits,
        exit,
        context: {
            address: { host: '127.0.0.1', port: 4321 },
            attachments: resourceAttachments('process'),
            dependencies: {},
            signal: scope.signal,
            workload: null
        },
        definition: createLocalProcessServiceDefinition(input, {
            spawn(command, output) {
                commands.push(command);
                output.appendStdout(Buffer.from('started'));
                output.appendStderr(Buffer.from('diagnostic'));
                return child;
            },
            async delay(milliseconds, signal) {
                waits.push({ milliseconds, signal });
                await Promise.resolve();
                await Promise.resolve();
                return false;
            }
        })
    };
}
