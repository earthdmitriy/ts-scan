import { targetFn } from './targets.js';

function subscribe(handler: () => void): void {
	handler();
}

export function registerHandler(): void {
	/*cursor:handler-decl*/
	const handler = (): void => {
		targetFn(0);
	};
	/*cursor:subscribe-arg*/
	subscribe(handler);
}

export function nonCallReference(): typeof targetFn {
	/*cursor:assign-ref*/
	const alias = targetFn;
	return alias;
}
