import { trackedFn } from './declaration.js';

export function invokeTracked(): number {
	/*cursor:call-site*/
	return trackedFn(2);
}

export function newish(): number {
	return trackedFn(3) + trackedFn(4);
}
