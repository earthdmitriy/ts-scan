export type Handler = (event: string, count: number) => void;

export function runWithHandler(handler: Handler): void {
	handler(/*sig:callback-arg0*/ 'ready', /*sig:callback-arg1*/ 1);
}

export function useCallbacks(): void {
	const handler: Handler = (event, count) => {
		void event;
		void count;
	};
	runWithHandler(handler);
}
