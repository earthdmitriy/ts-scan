import { arrowTarget, targetFn } from './targets.js';

export function directCaller(): number {
	/*cursor:direct-call*/
	return targetFn(1);
}

export function secondSite(): number {
	return targetFn(2) + targetFn(3);
}

export function usesArrow(): number {
	return arrowTarget(4);
}

/** Two distinct call sites in the same caller. */
export function twoSites(): number {
	const a = targetFn(10);
	const b = targetFn(20);
	return a + b;
}
