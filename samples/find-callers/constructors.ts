import { TargetClass } from './targets.js';

export function makeTarget(): TargetClass {
	/*cursor:new-target*/
	return new TargetClass(1);
}

export function useMethod(): number {
	const t = new TargetClass(2);
	return t.method();
}
