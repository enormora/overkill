import { describe, expect, test } from 'tstyche';
import { ReporterSinkConflictError } from './engine.entry-point.ts';

describe('ReporterSinkConflictError', function () {
    test('is exported as a typed reporter configuration failure', function () {
        expect(new ReporterSinkConflictError('conflict')).type.toBe<ReporterSinkConflictError>();
    });
});
