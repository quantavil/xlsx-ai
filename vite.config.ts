import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	resolve: {
		alias: {
			// The AI SDK pulls in 60 KB of OpenTelemetry to read one enum and a tracer it
			// never asks for. See src/lib/server/noop-otel.ts.
			'@opentelemetry/api': fileURLToPath(new URL('./src/lib/server/noop-otel.ts', import.meta.url))
		}
	},
	ssr: {
		// `ai` is bundled into the server build rather than left external, so the alias
		// above actually reaches its `@opentelemetry/api` import. Cloudflare's deploy-time
		// esbuild resolves external imports itself and would ignore the alias.
		noExternal: ['ai']
	},
	// @ts-ignore
	test: {
		include: ['tests/**/*.{test,spec}.ts'],
		exclude: ['e2e/**', 'node_modules/**']
	}
});
