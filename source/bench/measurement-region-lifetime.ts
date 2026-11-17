import { MeasurementContractError } from './measurement-contract-error.ts';

type PendingMeasurement<Value> = { readonly completion: Promise<Value>; };
export type MeasurementRegionLifetime = {
    readonly signal: AbortSignal;
    readonly begin: () => void;
    readonly finish: () => void;
    readonly ensureMeasured: () => void;
    readonly track: <Value>(pending: Promise<Value>) => PendingMeasurement<Value>;
    readonly dispose: () => Promise<void>;
};
export function createMeasurementRegionLifetime(signal: AbortSignal): MeasurementRegionLifetime {
    const controller = new AbortController();
    let begun = false;
    let finished = false;
    let pending: Promise<unknown> | null = null;
    return {
        signal: AbortSignal.any([ signal, controller.signal ]),
        begin() {
            if (begun) {
                throw new MeasurementContractError('Each sample must contain exactly one measurement region.', {});
            }
            begun = true;
        },
        finish() {
            finished = true;
        },
        ensureMeasured() {
            if (!begun || !finished) {
                throw new MeasurementContractError(
                    'Each sample must await exactly one complete measurement region.',
                    {}
                );
            }
        },
        track(operation) {
            const tracked = (async function completeRegion<Value>(value: Promise<Value>): Promise<Value> {
                const result = await value;
                finished = true;
                return result;
            })(operation);
            const retained = (async function retainRegionFailure(): Promise<void> {
                try {
                    await tracked;
                } catch {}
            })();
            pending = retained;
            return { completion: tracked };
        },
        async dispose() {
            controller.abort(new MeasurementContractError('Measurement invocation closed.', {}));
            try {
                await pending;
            } catch {}
        }
    };
}
