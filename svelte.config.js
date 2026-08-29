import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Cloudflare Pages. Every route is `ssr = false`, so the only thing that reaches
		// the worker is `/api/ai*`; everything else is served as a static asset.
		adapter: adapter()
	}
};

export default config;
