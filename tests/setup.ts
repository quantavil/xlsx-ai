import { plugin } from 'bun';
import { compileModule } from 'svelte/compiler';

const transpiler = new Bun.Transpiler({ loader: 'ts' });

plugin({
	name: 'svelte-module-loader',
	setup(build) {
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
