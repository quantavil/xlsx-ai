import { json, type RequestEvent } from '@sveltejs/kit';

interface Bucket {
	tokens: number;
	lastRefill: number;
}

const BUCKET_CAPACITY = 60; // Max burst
const REFILL_RATE_PER_SEC = 2; // Refill 2 tokens/sec (120/min)
// ponytail: buckets live in this isolate only, so the ceiling is per-worker and resets
// on eviction. Move to a Durable Object or KV if a single global limit ever matters.
const ipBuckets = new Map<string, Bucket>();

/**
 * Same-origin check and per-IP token bucket rate limiting for ICEGrid proxy endpoints.
 */
export function checkIcegridAccess(event: RequestEvent): Response | null {
	const { request, url } = event;

	// 1. Same-origin check
	const secFetchSite = request.headers.get('sec-fetch-site');
	if (secFetchSite === 'cross-site') {
		return json({ error: 'Cross-origin requests are forbidden.' }, { status: 403 });
	}

	const origin = request.headers.get('origin');
	if (origin) {
		try {
			const originHost = new URL(origin).host;
			if (originHost !== url.host) {
				return json({ error: 'Cross-origin requests are forbidden.' }, { status: 403 });
			}
		} catch {
			return json({ error: 'Invalid origin header.' }, { status: 403 });
		}
	}

	// 2. Per-IP Token Bucket rate limiting
	const ip =
		request.headers.get('cf-connecting-ip') ??
		request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
		(typeof event.getClientAddress === 'function' ? event.getClientAddress() : '127.0.0.1');

	const now = Date.now();
	let bucket = ipBuckets.get(ip);
	if (!bucket) {
		if (ipBuckets.size > 2000) ipBuckets.clear();
		bucket = { tokens: BUCKET_CAPACITY, lastRefill: now };
		ipBuckets.set(ip, bucket);
	} else {
		const elapsedSec = (now - bucket.lastRefill) / 1000;
		bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsedSec * REFILL_RATE_PER_SEC);
		bucket.lastRefill = now;
	}

	if (bucket.tokens < 1) {
		return json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
	}

	bucket.tokens -= 1;
	return null;
}
