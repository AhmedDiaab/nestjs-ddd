export type CursorPayload = Record<string, string | number | boolean | null>;

export function encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T extends CursorPayload>(token: string): T {
    return JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as T;
}
