import {
    formatDeprecationHeaders,
    parseDeprecatedOptions,
    type DeprecatedOptions,
} from '@interface/http/common/deprecation-headers.util';

describe('formatDeprecationHeaders', () => {
    it('formats Deprecation as @<unix-seconds> for the given since date', () => {
        // Arrange
        const options: DeprecatedOptions = { since: '2026-01-01', sunset: '2026-12-31' };
        const expectedSeconds = Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000);

        // Act
        const headers = formatDeprecationHeaders(options);

        // Assert
        expect(headers.Deprecation).toBe(`@${expectedSeconds}`);
    });

    it('formats Sunset as an IMF-fixdate HTTP-date', () => {
        // Arrange
        const options: DeprecatedOptions = { since: '2026-01-01', sunset: '2026-12-31' };
        const expected = new Date('2026-12-31T00:00:00Z').toUTCString();

        // Act
        const headers = formatDeprecationHeaders(options);

        // Assert
        expect(headers.Sunset).toBe(expected);
    });

    it('formats a past since identically to a future one: the headers are advisory, no special-casing', () => {
        // Arrange
        const past: DeprecatedOptions = { since: '2020-01-01', sunset: '2020-06-30' };
        const expectedSeconds = Math.floor(Date.parse('2020-01-01T00:00:00Z') / 1000);

        // Act
        const headers = formatDeprecationHeaders(past);

        // Assert
        expect(headers.Deprecation).toBe(`@${expectedSeconds}`);
    });

    it('formats a past sunset identically to a future one: the headers are advisory, no special-casing', () => {
        // Arrange
        const past: DeprecatedOptions = { since: '2020-01-01', sunset: '2020-06-30' };
        const expected = new Date('2020-06-30T00:00:00Z').toUTCString();

        // Act
        const headers = formatDeprecationHeaders(past);

        // Assert
        expect(headers.Sunset).toBe(expected);
    });

    it('sets Link with only rel="successor-version" when only successor is given', () => {
        // Arrange
        const options: DeprecatedOptions = {
            since: '2026-01-01',
            sunset: '2026-12-31',
            successor: 'https://api.example.com/v2/orders',
        };

        // Act
        const headers = formatDeprecationHeaders(options);

        // Assert
        expect(headers.Link).toBe('<https://api.example.com/v2/orders>; rel="successor-version"');
    });

    it('sets Link with only rel="deprecation" when only link is given', () => {
        // Arrange
        const options: DeprecatedOptions = {
            since: '2026-01-01',
            sunset: '2026-12-31',
            link: 'https://docs.example.com/deprecations/orders-v1',
        };

        // Act
        const headers = formatDeprecationHeaders(options);

        // Assert
        expect(headers.Link).toBe(
            '<https://docs.example.com/deprecations/orders-v1>; rel="deprecation"',
        );
    });

    it('joins both Link values with ", " into one header when both are given', () => {
        // Arrange
        const options: DeprecatedOptions = {
            since: '2026-01-01',
            sunset: '2026-12-31',
            successor: 'https://api.example.com/v2/orders',
            link: 'https://docs.example.com/deprecations/orders-v1',
        };

        // Act
        const headers = formatDeprecationHeaders(options);

        // Assert
        expect(headers.Link).toBe(
            '<https://api.example.com/v2/orders>; rel="successor-version", ' +
                '<https://docs.example.com/deprecations/orders-v1>; rel="deprecation"',
        );
    });

    it('omits Link entirely when neither successor nor link is given', () => {
        // Arrange
        const options: DeprecatedOptions = { since: '2026-01-01', sunset: '2026-12-31' };

        // Act
        const headers = formatDeprecationHeaders(options);

        // Assert
        expect(headers.Link).toBeUndefined();
        expect('Link' in headers).toBe(false);
    });
});

describe('parseDeprecatedOptions', () => {
    it('throws for a malformed since date', () => {
        // Arrange
        const options: DeprecatedOptions = { since: 'not-a-date', sunset: '2026-12-31' };

        // Act
        const act = () => parseDeprecatedOptions(options);

        // Assert
        expect(act).toThrow(Error);
    });

    it('throws for a malformed sunset date', () => {
        // Arrange
        const options: DeprecatedOptions = { since: '2026-01-01', sunset: 'not-a-date' };

        // Act
        const act = () => parseDeprecatedOptions(options);

        // Assert
        expect(act).toThrow(Error);
    });

    it('throws for a sunset earlier than since, naming both dates', () => {
        // Arrange
        const options: DeprecatedOptions = { since: '2026-12-31', sunset: '2026-01-01' };

        // Act
        const act = () => parseDeprecatedOptions(options);

        // Assert
        expect(act).toThrow(/2026-12-31/);
        expect(act).toThrow(/2026-01-01/);
    });

    it('throws for a non-absolute successor URL', () => {
        // Arrange
        const options: DeprecatedOptions = {
            since: '2026-01-01',
            sunset: '2026-12-31',
            successor: '/v2/orders',
        };

        // Act
        const act = () => parseDeprecatedOptions(options);

        // Assert
        expect(act).toThrow(Error);
    });

    it('throws for a non-absolute link URL', () => {
        // Arrange
        const options: DeprecatedOptions = {
            since: '2026-01-01',
            sunset: '2026-12-31',
            link: '/docs/deprecations/orders-v1',
        };

        // Act
        const act = () => parseDeprecatedOptions(options);

        // Assert
        expect(act).toThrow(Error);
    });

    it('passes a valid input through unchanged', () => {
        // Arrange
        const options: DeprecatedOptions = {
            since: '2026-01-01',
            sunset: '2026-12-31',
            successor: 'https://api.example.com/v2/orders',
            link: 'https://docs.example.com/deprecations/orders-v1',
            note: 'Use v2 instead.',
        };

        // Act
        const parsed = parseDeprecatedOptions(options);

        // Assert
        expect(parsed).toEqual(options);
    });
});
