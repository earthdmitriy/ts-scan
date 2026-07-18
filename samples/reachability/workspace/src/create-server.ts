import { attachAppBridge } from './bridge-attach.js';

/**
 * Package-level server entry (re-exported from public.ts).
 */
export function createServer(): number {
	/*cursor:create-server*/
	return attachAppBridge();
}
