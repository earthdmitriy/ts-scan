/** Shared helpers for reachability fixtures. */

export function leafHelper(): number {
	return 1;
}

export function midHelper(): number {
	/*cursor:mid-calls-leaf*/
	return leafHelper();
}

/** Called only from tests. */
export function onlyFromTest(): number {
	/*cursor:only-from-test*/
	return leafHelper();
}

/** Two roots converge through this helper onto leafHelper. */
export function convergeA(): number {
	return leafHelper();
}

export function convergeB(): number {
	return leafHelper();
}

export function cycleTarget(): number {
	return 1;
}

export function cyclePeer(): number {
	/*cursor:cycle-peer*/
	cycleCaller();
	return cycleTarget();
}

export function cycleCaller(): number {
	return cyclePeer();
}

export function cycleRoot(): number {
	/*cursor:cycle-root*/
	return cycleCaller();
}

export function deep1(): number {
	return leafHelper();
}

export function deep2(): number {
	return deep1();
}

export function deep3(): number {
	return deep2();
}

export function deep4(): number {
	return deep3();
}

export function deep5(): number {
	return deep4();
}

export function deep6(): number {
	return deep5();
}

export function deep7(): number {
	return deep6();
}
