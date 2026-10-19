import { isMainThread, workerData } from 'node:worker_threads';
import { createProcessSamplingSession } from '../../../bench/process-sampling.ts';
import { processMeasurement } from '../../../bench/process-measurement.ts';

const session = createProcessSamplingSession(processMeasurement({ instrumentation: 'off' }), new AbortController().signal);
await session.sample('measured').sample.process({
    command: [
        process.execPath, '-e',
        'const fs=require("node:fs");fs.writeFileSync(process.argv[1]+".pending",String(process.pid));fs.renameSync(process.argv[1]+".pending",process.argv[1]);setInterval(()=>{},1000)',
        String(isMainThread ? process.argv[2] : workerData)
    ],
    cwd: process.cwd(), env: null, io: { kind: 'pipes' },
    completion: { kind: 'ready', marker: { stream: 'stdout', text: 'Never' } }
});
