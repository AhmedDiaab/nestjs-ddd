/**
 * Parses a JSON string or passes objects through.
 * Parse failures never echo the input: config JSON can carry secrets.
 */
export function parseJson<T = unknown>(raw: unknown): T | undefined {
    if (raw == null || raw === '') return undefined;
    if (typeof raw === 'object') return raw as T;
    if (typeof raw !== 'string') throw new Error('Expected JSON string or object');

    try {
        return JSON.parse(raw) as T;
    } catch {
        throw new Error('Invalid JSON (value hidden)');
    }
}
