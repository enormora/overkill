import { fileURLToPath } from 'node:url';
import { readProcessEnvironment } from './node-host-readers.ts';

export const executionSessionProcessUrl = import.meta.url;
export const executionSessionProcessArgument = '--overkill-execution-session';
export function readExecutionSessionEnvironment(): Readonly<Record<string, string | undefined>> {
    return readProcessEnvironment(process);
}

async function startExecutionSessionHost(): Promise<void> {
    await import('./execution-session-host.ts');
}

if (
    process.argv[1] === fileURLToPath(executionSessionProcessUrl) &&
    process.argv.includes(executionSessionProcessArgument)
) {
    await startExecutionSessionHost();
}
