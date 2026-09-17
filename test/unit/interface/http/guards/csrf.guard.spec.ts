import type { ConfigPort } from '@application/ports';
import { CsrfRejectedError } from '@interface/http/errors';
import { CsrfGuard } from '@interface/http/guards';
import type { ExecutionContext } from '@nestjs/common';

type RequestInit = {
    method?: string;
    cookie?: boolean;
    headers?: Record<string, string>;
};

const configWith = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigPort;

const defaults = {
    'http.csrfEnabled': true,
    'jwt.cookieName': 'jwt',
    'http.csrfTrustedOrigins': undefined,
    'http.corsOrigins': ['https://app.example.com'],
};

function contextFor({ method = 'POST', cookie = true, headers = {} }: RequestInit) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const req = {
        method,
        protocol: 'https',
        cookies: cookie ? { jwt: 'token' } : {},
        headers: { host: 'api.example.com', ...lower },
        get: (name: string) => ({ host: 'api.example.com', ...lower })[name.toLowerCase()],
    };
    return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
    it.each<[string, RequestInit]>([
        ['safe methods', { method: 'GET', headers: { origin: 'https://evil.example' } }],
        [
            'requests without the auth cookie',
            { cookie: false, headers: { origin: 'https://evil.example' } },
        ],
        [
            'requests with an Authorization header',
            { headers: { authorization: 'Bearer x', origin: 'https://evil.example' } },
        ],
        ['Sec-Fetch-Site: same-origin', { headers: { 'sec-fetch-site': 'same-origin' } }],
        ['the API’s own origin', { headers: { origin: 'https://api.example.com' } }],
        [
            'a trusted origin (CORS allow-list by default)',
            { headers: { origin: 'https://app.example.com' } },
        ],
        [
            'a trusted Referer when Origin is absent',
            { headers: { referer: 'https://app.example.com/page' } },
        ],
    ])('allows %s', (_case, init) => {
        // Arrange
        const sut = new CsrfGuard(configWith(defaults));

        // Act
        const allowed = sut.canActivate(contextFor(init));

        // Assert
        expect(allowed).toBe(true);
    });

    it.each<[string, RequestInit]>([
        ['an untrusted origin', { headers: { origin: 'https://evil.example' } }],
        [
            'a cross-site fetch',
            { headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } },
        ],
        ['no Origin or Referer', { method: 'DELETE' }],
        ['an unparsable Referer', { headers: { referer: 'not a url' } }],
    ])('rejects cookie-authenticated writes with %s', (_case, init) => {
        // Arrange
        const sut = new CsrfGuard(configWith(defaults));

        // Act
        const check = () => sut.canActivate(contextFor(init));

        // Assert
        expect(check).toThrow(CsrfRejectedError);
    });

    it('uses CSRF_TRUSTED_ORIGINS instead of the CORS list when set', () => {
        // Arrange
        const config = configWith({
            ...defaults,
            'http.csrfTrustedOrigins': ['https://admin.example.com'],
        });
        const sut = new CsrfGuard(config);

        // Act
        const check = () =>
            sut.canActivate(contextFor({ headers: { origin: 'https://app.example.com' } }));

        // Assert
        expect(check).toThrow(CsrfRejectedError);
    });

    it('allows everything when disabled', () => {
        // Arrange
        const sut = new CsrfGuard(configWith({ ...defaults, 'http.csrfEnabled': false }));

        // Act
        const allowed = sut.canActivate(
            contextFor({ headers: { origin: 'https://evil.example' } }),
        );

        // Assert
        expect(allowed).toBe(true);
    });
});
