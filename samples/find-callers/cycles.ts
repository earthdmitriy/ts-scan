export function cycleA(): number {
	/*cursor:cycle-a*/
	return cycleB();
}

export function cycleB(): number {
	/*cursor:cycle-b*/
	return cycleA();
}

export function entry(): number {
	return cycleA();
}
