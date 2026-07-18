import path from 'path';
import { Project } from 'ts-morph';
import { getTsMorphProjectForFile } from '../src/tools/getTsMorphProject.js';

/**
 * Resolve a ts-morph Project for a fixture/source file used in tests.
 */
export const projectFor = (filePath: string): Project => {
	const absolute = path.resolve(filePath);
	const result = getTsMorphProjectForFile(absolute);
	if (!result.success) {
		throw new Error(result.error);
	}
	return result.data.project;
};

export const rootProject = (): Project => projectFor('src/types.ts');
