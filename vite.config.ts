import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// @ts-ignore
	test: {
		include: ['tests/**/*.{test,spec}.ts'],
		exclude: ['e2e/**', 'node_modules/**']
	}
});
