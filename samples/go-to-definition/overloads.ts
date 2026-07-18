export function overloadTarget(x: string): string;
export function overloadTarget(x: number): number;
export function overloadTarget(x: string | number): string | number {
	return x;
}

export function callOverload(): string {
	/*cursor:overload-call*/
	return overloadTarget('hi');
}
