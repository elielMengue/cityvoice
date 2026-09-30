/** Just the call signature of fetch, so fakes and wrappers fit without runtime extras. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * The global fetch, wrapped so it can be stored and passed around. Workers
 * refuse `fetch` called as a method of another object ("Illegal invocation"),
 * which is what happens once it is kept in a field. Bun does not mind, so
 * tests alone would not catch it.
 */
export const boundFetch: FetchLike = (input, init) => fetch(input, init);
