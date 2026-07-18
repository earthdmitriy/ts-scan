import { trackedValue } from './declaration.js';

// trackedValue should not match from comments
const note = 'trackedValue in a string should not match';

export function realUse(): number {
	/*cursor:comment-real*/
	return trackedValue;
}

void note;
