/**
 * Stand-in for `@opentelemetry/api`, aliased in `vite.config.ts`.
 *
 * The AI SDK imports this package unconditionally but only reaches it in two places:
 * `getTracer()` returns the SDK's own no-op tracer unless `experimental_telemetry`
 * is enabled (we never enable it), and `recordErrorOnSpan` reads `SpanStatusCode.ERROR`.
 * The real package is 60 KB of tracing machinery for those two touch points, all of it
 * shipped in the Cloudflare worker.
 *
 * ponytail: covers the surface `ai` actually uses. If a future AI SDK version imports
 * more of the OpenTelemetry API, drop the alias in `vite.config.ts` and take the 60 KB
 * back — the budget has room.
 */

/** Spec values from `@opentelemetry/api`; `ai` only ever reads `ERROR`. */
export const SpanStatusCode = Object.freeze({ UNSET: 0, OK: 1, ERROR: 2 });

const noopSpan = {
	end: () => {},
	setStatus: () => noopSpan,
	setAttribute: () => noopSpan,
	setAttributes: () => noopSpan,
	addEvent: () => noopSpan,
	recordException: () => {},
	updateName: () => noopSpan,
	isRecording: () => false,
	spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 })
};

const noopTracer = {
	startSpan: () => noopSpan,
	// Telemetry is off, so this is only reachable if someone enables it later. Degrade
	// to a no-op rather than throwing inside a live request.
	startActiveSpan: (_name: string, ...rest: unknown[]) => {
		const fn = rest[rest.length - 1] as (span: typeof noopSpan) => unknown;
		return fn(noopSpan);
	}
};

export const trace = Object.freeze({
	getTracer: () => noopTracer,
	getActiveSpan: () => undefined,
	setSpan: <T>(context: T) => context,
	getSpan: () => undefined
});
