import { Session, type Profiler } from 'node:inspector';

export type CoverageProfiler = {
    readonly connect: () => void;
    readonly disconnect: () => void;
    readonly enable: () => Promise<void>;
    readonly disable: () => Promise<void>;
    readonly start: () => Promise<void>;
    readonly stop: () => Promise<void>;
    readonly take: () => Promise<Profiler.TakePreciseCoverageReturnType>;
};
type ProfilerControlCommand = 'Profiler.disable' | 'Profiler.enable' | 'Profiler.stopPreciseCoverage';
async function postProfilerControl(inspector: Session, method: ProfilerControlCommand): Promise<void> {
    await new Promise<void>(function postCommand(resolve, reject) {
        inspector.post(method, function completeCommand(error) {
            if (error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

async function startPreciseCoverage(inspector: Session): Promise<void> {
    await new Promise<void>(function postCommand(resolve, reject) {
        inspector.post('Profiler.startPreciseCoverage', {
            allowTriggeredUpdates: false,
            callCount: true,
            detailed: true
        }, function completeCommand(error) {
            if (error === null) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

async function takePreciseCoverage(inspector: Session): Promise<Profiler.TakePreciseCoverageReturnType> {
    return await new Promise<Profiler.TakePreciseCoverageReturnType>(function postCommand(resolve, reject) {
        inspector.post('Profiler.takePreciseCoverage', function completeCommand(error, result) {
            if (error === null) {
                resolve(result);
            } else {
                reject(error);
            }
        });
    });
}

export function createCoverageProfiler(): CoverageProfiler {
    const inspector = new Session();
    return {
        connect: inspector.connect.bind(inspector),
        disconnect: inspector.disconnect.bind(inspector),
        enable: postProfilerControl.bind(null, inspector, 'Profiler.enable'),
        disable: postProfilerControl.bind(null, inspector, 'Profiler.disable'),
        start: startPreciseCoverage.bind(null, inspector),
        stop: postProfilerControl.bind(null, inspector, 'Profiler.stopPreciseCoverage'),
        take: takePreciseCoverage.bind(null, inspector)
    };
}
