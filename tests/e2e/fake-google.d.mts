/** The stand-in for Google used by the tests (see fake-google.mjs). */
export function startFakeGoogle(options: { port: number; clientId: string; clientSecret: string }): Promise<{ origin: string; close(): Promise<void> }>;
