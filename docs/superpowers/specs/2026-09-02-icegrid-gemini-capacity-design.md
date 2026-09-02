# ICEGrid Gemini Capacity Handling

## Problem

ICEGrid document extraction sends a larger, schema-constrained request than table chat. When the selected Gemini model is temporarily overloaded, Google returns HTTP 503. AI SDK retries twice by default, then wraps the final provider error in `RetryError`. The API route inspects only the wrapper, so it loses the nested 503 status and returns a generic HTTP 502 message.

The selected model must remain authoritative. ICEGrid must not fall back to a different model.

## Design

ICEGrid module generation will use four retries, giving the selected model five total attempts with AI SDK exponential backoff. Standard table and chat operations will retain the SDK default so interactive requests do not acquire the longer module latency.

The API error path will inspect retry wrappers and their `lastError` chain before classifying provider failures. A final Gemini 503 will be returned as HTTP 503 with a concise message that names the selected model, states how many attempts were made, and asks the user to retry the import shortly. Existing handling for cancellation, timeout, authentication, rate limiting, missing models, and other provider errors will remain unchanged.

## Data Flow

1. The browser sends the ICEGrid module request with the configured provider, API key, and selected model ID.
2. The server creates that exact language model and executes the ICEGrid handler.
3. ICEGrid structured generation allows four retries under the existing three-minute module deadline.
4. If all attempts receive a transient capacity error, the route unwraps the final provider error, identifies HTTP 503, and responds with a matching status and actionable message.
5. The browser surfaces the server message in the existing error toast. It does not select or call another model.

## Testing

Tests will be written before production changes and will cover:

- ICEGrid extraction configures four retries while chat keeps its existing behavior.
- A retry wrapper containing a provider 503 is classified as HTTP 503.
- The returned message identifies the selected model and the five total attempts.
- Existing targeted AI and ICEGrid tests, type checking, and the production build remain green.

No live Gemini request is required for automated verification.
