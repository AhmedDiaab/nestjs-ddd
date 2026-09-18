import { decodeCursor, encodeCursor, type CursorPayload } from '@shared/pagination';

describe('cursor', () => {
    describe('encodeCursor / decodeCursor', () => {
        it('round-trips a payload of every allowed value type', () => {
            // Arrange
            const payload: CursorPayload = { id: 42, createdAt: '2026-09-18', archived: false };

            // Act
            const token = encodeCursor(payload);
            const decoded = decodeCursor(token);

            // Assert
            expect(decoded).toEqual(payload);
        });

        it('round-trips a null value', () => {
            // Arrange
            const payload: CursorPayload = { deletedAt: null };

            // Act
            const decoded = decodeCursor(encodeCursor(payload));

            // Assert
            expect(decoded).toEqual(payload);
        });

        it('round-trips an empty payload', () => {
            // Arrange
            const payload: CursorPayload = {};

            // Act
            const decoded = decodeCursor(encodeCursor(payload));

            // Assert
            expect(decoded).toEqual({});
        });

        it('produces an opaque, URL-safe token with no padding characters', () => {
            // Arrange
            const payload: CursorPayload = { id: 1 };

            // Act
            const token = encodeCursor(payload);

            // Assert
            expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it('rejects a truncated cursor rather than half-parsing it', () => {
            // Arrange
            const token = encodeCursor({ id: 1, createdAt: '2026-09-18' });
            const truncated = token.slice(0, -4);

            // Act
            const act = () => decodeCursor(truncated);

            // Assert
            expect(act).toThrow();
        });

        it('rejects an empty string', () => {
            // Arrange: no cursor at all

            // Act
            const act = () => decodeCursor('');

            // Assert
            expect(act).toThrow();
        });

        it('rejects a tampered cursor rather than silently returning a different payload', () => {
            // Arrange
            const token = encodeCursor({ id: 1, createdAt: '2026-09-18' });
            const flippedChar = token[5] === 'A' ? 'B' : 'A';
            const tampered = token.slice(0, 5) + flippedChar + token.slice(6);

            // Act
            const act = () => decodeCursor(tampered);

            // Assert
            expect(act).toThrow();
        });

        it('rejects a token that is not base64url/JSON at all', () => {
            // Arrange
            const garbage = 'not a cursor!!!';

            // Act
            const act = () => decodeCursor(garbage);

            // Assert
            expect(act).toThrow();
        });
    });
});
