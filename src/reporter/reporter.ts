import { SuiteResult } from '../runner';

export interface Reporter {
  update(currentResult: SuiteResult): Promise<void>;
}
