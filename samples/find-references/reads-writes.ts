import { trackedMutable, trackedValue } from './declaration.js';

export function mutateTracked(): number {
	/*cursor:write-access*/
	trackedMutable = trackedValue;
	/*cursor:read-access*/
	const copy = trackedValue;
	return copy + trackedMutable;
}
