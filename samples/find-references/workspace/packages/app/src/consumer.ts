import { sharedHelper } from '../../library/src/api.js';

export function runShared(): string {
	/*cursor:app-call*/
	return sharedHelper('app');
}
