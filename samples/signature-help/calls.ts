export function plainFn(a: string, b: number, c: boolean): string {
	return a;
}

export class Box {
	constructor(
		public width: number,
		public height: number,
	) {}

	method(x: string, y: number): void {
		void x;
		void y;
	}
}

export function useCalls(): void {
	plainFn(/*sig:callee*/'a', 1, true);

	plainFn(/*sig:open-paren*/ 'a', 1, true);

	plainFn(/*sig:arg0*/ 'a', /*sig:arg1*/ 1, /*sig:arg2*/ true);

	plainFn('a', 1, /*sig:trailing*/);

	new Box(/*sig:ctor-arg0*/ 10, /*sig:ctor-arg1*/ 20);

	const box = new Box(1, 2);
	box.method(/*sig:method-arg0*/ 'x', /*sig:method-arg1*/ 2);

	plainFn(String(/*sig:nested-inner*/ 42), 1, true);

	const outside = /*sig:outside*/ 42;
	void outside;
}
