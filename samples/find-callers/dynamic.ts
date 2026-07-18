import { targetFn } from './targets.js';

export function dynamicAnyCaller(): number {
	const fn: any = targetFn;
	/*cursor:dynamic-call*/
	return fn(1);
}

export function typedFunctionCaller(): number {
	const fn: Function = targetFn;
	return (fn as (n: number) => number)(2);
}
