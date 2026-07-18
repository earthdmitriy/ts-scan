import { emitBootstrap } from './targets.js';

/** Workspace-shaped: attachAppBridge → emitBootstrap */
export function attachAppBridge(): void {
	/*cursor:attach*/
	emitBootstrap();
}
