import {
	convergeA,
	cycleRoot,
	deep7,
	midHelper,
} from './internal.js';

export { createServer } from './create-server.js';

/** Package export entry (`package.json#exports`). */
export function publicApi(): number {
	/*cursor:public-api*/
	return midHelper();
}

export function publicConverge(): number {
	return convergeA();
}

export function publicDeep(): number {
	return deep7();
}

export function publicCycle(): number {
	return cycleRoot();
}
