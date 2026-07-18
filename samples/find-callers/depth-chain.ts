import { targetFn } from './targets.js';

export function level1(): number {
	return targetFn(1);
}

export function level2(): number {
	return level1();
}

export function level3(): number {
	return level2();
}

export function level4(): number {
	return level3();
}
