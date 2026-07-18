export const trackedValue = 1;

export let trackedMutable = 0;

export type TrackedId = string;

export function trackedFn(x: number): number {
	return x + 1;
}

export function useTracked(): number {
	/*cursor:decl-read*/
	return trackedValue;
}

export function bumpMutable(): number {
	/*cursor:decl-write*/
	trackedMutable += 1;
	return trackedMutable;
}
