import { clientEmit, externalOverload } from 'signature-package';

export function useExternal(): void {
	clientEmit(/*sig:client-emit*/ 'bridge', { ok: true });
	externalOverload(/*sig:external-overload*/ 'hi');
}
