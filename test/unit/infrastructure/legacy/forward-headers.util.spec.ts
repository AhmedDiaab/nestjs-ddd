import type { IncomingHttpHeaders } from 'node:http';
import {
    buildForwardHeaders,
    stripHopByHopHeaders,
    type ForwardHeadersInput,
} from '@infrastructure/legacy';

function baseInput(overrides: Partial<ForwardHeadersInput> = {}): ForwardHeadersInput {
    return {
        headers: {},
        remoteAddress: '203.0.113.5',
        protocol: 'http',
        hostHeader: 'app.example.com',
        targetHost: 'legacy-host:8080',
        preserveHostHeader: false,
        requestId: { header: 'x-request-id', value: 'req-1' },
        ...overrides,
    };
}

describe('buildForwardHeaders', () => {
    it('strips hop-by-hop headers', () => {
        // Arrange
        const headers: IncomingHttpHeaders = {
            connection: 'keep-alive',
            'keep-alive': 'timeout=5',
            'transfer-encoding': 'chunked',
            upgrade: 'h2c',
            'proxy-authenticate': 'Basic',
            'proxy-authorization': 'Basic abc',
            te: 'trailers',
            trailer: 'X-Checksum',
            accept: 'application/json',
        };

        // Act
        const result = buildForwardHeaders(baseInput({ headers }));

        // Assert
        expect(result.connection).toBeUndefined();
        expect(result['keep-alive']).toBeUndefined();
        expect(result['transfer-encoding']).toBeUndefined();
        expect(result.upgrade).toBeUndefined();
        expect(result['proxy-authenticate']).toBeUndefined();
        expect(result['proxy-authorization']).toBeUndefined();
        expect(result.te).toBeUndefined();
        expect(result.trailer).toBeUndefined();
        expect(result.accept).toBe('application/json');
    });

    it('passes Authorization and cookies through unchanged', () => {
        // Arrange
        const headers: IncomingHttpHeaders = {
            authorization: 'Bearer token-123',
            cookie: 'session=abc; theme=dark',
        };

        // Act
        const result = buildForwardHeaders(baseInput({ headers }));

        // Assert
        expect(result.authorization).toBe('Bearer token-123');
        expect(result.cookie).toBe('session=abc; theme=dark');
    });

    it('sets the request-id header to the resolved value', () => {
        // Arrange
        const input = baseInput({ requestId: { header: 'x-request-id', value: 'resolved-id' } });

        // Act
        const result = buildForwardHeaders(input);

        // Assert
        expect(result['x-request-id']).toBe('resolved-id');
    });

    it('creates X-Forwarded-For when none was present', () => {
        // Arrange
        const input = baseInput({ headers: {}, remoteAddress: '198.51.100.7' });

        // Act
        const result = buildForwardHeaders(input);

        // Assert
        expect(result['x-forwarded-for']).toBe('198.51.100.7');
    });

    it('appends to an existing X-Forwarded-For', () => {
        // Arrange
        const input = baseInput({
            headers: { 'x-forwarded-for': '10.0.0.1' },
            remoteAddress: '198.51.100.7',
        });

        // Act
        const result = buildForwardHeaders(input);

        // Assert
        expect(result['x-forwarded-for']).toBe('10.0.0.1, 198.51.100.7');
    });

    it('sets X-Forwarded-Proto and X-Forwarded-Host from the request', () => {
        // Arrange
        const input = baseInput({ protocol: 'https', hostHeader: 'app.example.com' });

        // Act
        const result = buildForwardHeaders(input);

        // Assert
        expect(result['x-forwarded-proto']).toBe('https');
        expect(result['x-forwarded-host']).toBe('app.example.com');
    });

    it('uses the legacy target as Host when preserveHostHeader is false', () => {
        // Arrange
        const input = baseInput({ preserveHostHeader: false, targetHost: 'legacy-host:8080' });

        // Act
        const result = buildForwardHeaders(input);

        // Assert
        expect(result.host).toBe('legacy-host:8080');
    });

    it('keeps the original Host when preserveHostHeader is true', () => {
        // Arrange
        const input = baseInput({ preserveHostHeader: true, hostHeader: 'app.example.com' });

        // Act
        const result = buildForwardHeaders(input);

        // Assert
        expect(result.host).toBe('app.example.com');
    });
});

describe('stripHopByHopHeaders', () => {
    it('drops headers that describe this hop rather than the client connection', () => {
        // Arrange
        const upstream = {
            connection: 'keep-alive',
            'keep-alive': 'timeout=5',
            'transfer-encoding': 'chunked',
            upgrade: 'h2c',
            'proxy-authenticate': 'Basic',
            te: 'trailers',
            trailer: 'Expires',
        };

        // Act
        const result = stripHopByHopHeaders(upstream);

        // Assert
        expect(result).toEqual({});
    });

    it('keeps the headers the client actually needs', () => {
        // Arrange
        const upstream = {
            'content-type': 'application/json',
            'content-length': '12',
            'set-cookie': ['session=abc'],
            etag: 'W/"1"',
            connection: 'close',
        };

        // Act
        const result = stripHopByHopHeaders(upstream);

        // Assert
        expect(result).toEqual({
            'content-type': 'application/json',
            'content-length': '12',
            'set-cookie': ['session=abc'],
            etag: 'W/"1"',
        });
    });
});
