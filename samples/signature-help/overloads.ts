export function overloadTarget(x: string): string;
export function overloadTarget(x: number): number;
export function overloadTarget(x: string | number): string | number {
	return x;
}

export function useOverloads(): void {
	overloadTarget(/*sig:overload-string*/ 'hi');
	overloadTarget(/*sig:overload-number*/ 42);
}
