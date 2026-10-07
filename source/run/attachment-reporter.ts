import { defineReporter, type ReporterEvent, type DefinedReporter } from '../engine/reporter.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import { currentAttachmentCoordinator, type AttachmentCoordinator } from './attachment-coordinator-context.ts';

function eventWithAttachments(event: ReporterEvent, coordinator: AttachmentCoordinator): ReporterEvent {
    if (event.kind !== 'test-end') {
        return event;
    }
    coordinator.settleAttempt(
        event.workId ?? createDefaultWorkId(event.case),
        { index: event.attempt },
        event.verdict,
        null
    );
    return {
        ...event,
        artifacts: [
            ...event.artifacts,
            ...coordinator.caseArtifacts(
                event.workId ?? createDefaultWorkId(event.case),
                { index: event.attempt },
                null
            )
        ]
    };
}
export function reporterWithAttachments(definition: DefinedReporter): DefinedReporter {
    const coordinator = currentAttachmentCoordinator();
    if (coordinator === null) {
        return definition;
    }
    return defineReporter(function createAttachmentReporter(context) {
        const reporter = definition(context);
        if (reporter.kind !== 'real-time') {
            return reporter;
        }
        return new Proxy(reporter, {
            get(target, property, receiver) {
                if (property === 'onEvent') {
                    return async function deliverAttachmentEvent(event: ReporterEvent) {
                        return await target.onEvent(eventWithAttachments(event, coordinator));
                    };
                }
                const original: unknown = Reflect.get(target, property, receiver);
                return original;
            }
        });
    });
}
