import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';
import { propertyWitnessSchema, type PropertyWitnessFile } from '../engine/witness-file.ts';
import { serializedValueSchema } from './serialized-value-schema.ts';
import { childProcessEntryPointUrl } from './child-process.entry-point.ts';
import { CorpusOperationError, type CorpusRequest } from './corpus-types.ts';

const maximumReplyBytes = 8_388_608;
const replySchema = z.strictObject({
    witness: propertyWitnessSchema,
    source: serializedValueSchema,
    output: serializedValueSchema
});
function verifyCompatibility(request: CorpusRequest, witness: PropertyWitnessFile): void {
    const { format, codec } = witness.counterexample;
    if (format.name !== 'overkill-property-graph' || format.version !== 1) {
        throw new CorpusOperationError('Unsupported corpus transport format.', { cause: null }, 'compatibility');
    }
    if (request.codec.kind === 'built-in' && (codec.name !== 'overkill-standard-input' || codec.version !== 1)) {
        throw new CorpusOperationError('A supported input codec is required.', { cause: null }, 'compatibility');
    }
}
export async function inspectCorpusInput(
    request: CorpusRequest,
    witness: PropertyWitnessFile,
    migrate: boolean
): Promise<z.output<typeof replySchema>> {
    verifyCompatibility(request, witness);
    const codec = request.codec.kind === 'built-in' ? request.codec : {
        ...request.codec,
        path: path.resolve(request.cwd, request.codec.path)
    };
    try {
        const output = await new Promise<string>(function execute(resolve, reject) {
            const child = execFile(
                process.execPath,
                [
                    '--permission',
                    '--allow-fs-read=*',
                    fileURLToPath(childProcessEntryPointUrl),
                    '--overkill-child-role=corpus-codec'
                ],
                { cwd: request.cwd, env: {}, timeout: 2000, killSignal: 'SIGKILL', maxBuffer: maximumReplyBytes },
                function complete(error, stdout, stderr) {
                    if (error !== null || stderr.length > 0) {
                        reject(error ?? new Error(stderr));
                    } else {
                        resolve(stdout);
                    }
                }
            );
            child.stdin?.on('error', function inputFailed() {
                child.kill('SIGKILL');
            });
            child.stdin?.end(JSON.stringify({ witness, codec, migrate }));
        });
        return replySchema.parse(JSON.parse(output));
    } catch (error: unknown) {
        throw new CorpusOperationError(
            'Corpus input decoding or migration failed.',
            { cause: error },
            'codec-execution'
        );
    }
}
