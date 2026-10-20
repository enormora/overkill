import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as summaries } from './normalization-summaries.test.ts';
import { testNode as sampling } from './calibration-sampling.test.ts';
import { testNode as contracts } from './calibration-contracts.test.ts';
import { testNode as reports } from './calibration-report.test.ts';
import { testNode as intervals } from './normalization-interval.test.ts';

export const testNode = suite('benchmark calibration', [ contracts, reports, intervals, sampling, summaries ]);
