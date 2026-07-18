import { sharedCallable } from '../../library/src/api.js';

export function runShared(): string {
	/*cursor:app-call*/
	return sharedCallable('app');
}
