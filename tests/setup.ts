import { plugin, type PluginBuilder } from 'bun';
import { compileModule } from 'svelte/compiler';

const transpiler = new Bun.Transpiler({ loader: 'ts' });

plugin({
	name: 'svelte-module-loader',
	setup(build: PluginBuilder) {
		build.onLoad({ filter: /\.svelte\.ts$/ }, async (args) => {
			const text = await Bun.file(args.path).text();
			const jsCode = transpiler.transformSync(text);
			const result = compileModule(jsCode, {
				filename: args.path,
				generate: 'client',
				dev: true
			});
			return {
				contents: result.js.code,
				loader: 'js'
			};
		});
	}
});

// The runes stores talk to localStorage directly; give the Bun runner a real one.
if (typeof globalThis.localStorage === 'undefined') {
	const store = new Map<string, string>();
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
			setItem: (k: string, v: string) => void store.set(k, String(v)),
			removeItem: (k: string) => void store.delete(k),
			clear: () => store.clear(),
			key: (i: number) => [...store.keys()][i] ?? null,
			get length() {
				return store.size;
			}
		}
	});
}
