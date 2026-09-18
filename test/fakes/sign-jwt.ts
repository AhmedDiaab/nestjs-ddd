import { createHmac } from 'node:crypto';

/**
 * The app only verifies tokens (`passport-jwt`); nothing in `src` signs one, so tests sign their
 * own HS256 token by hand instead of pulling in a JWT library just for that.
 */
const base64url = (input: string): string => Buffer.from(input).toString('base64url');

export function signJwt(payload: object, secret: string, expiresInSec = 3600): string {
    const iat = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64url(JSON.stringify({ ...payload, iat, exp: iat + expiresInSec }));
    const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
}
