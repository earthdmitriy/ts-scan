import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Default forks/threads pool breaks suite context on Node 24 here.
		pool: 'vmThreads',
		exclude: [
			'**/node_modules/**',
			'**/dist/**',
			// Fixture sources may use *.test.ts names without being Vitest suites.
			'samples/**',
		],
	},
});
