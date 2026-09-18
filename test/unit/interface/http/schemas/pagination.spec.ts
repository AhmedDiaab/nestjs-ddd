import { CursorQuerySchema, OffsetQuerySchema } from '@interface/http/schemas';

describe('pagination schemas', () => {
    describe('OffsetQuerySchema', () => {
        it('defaults page, size and orderBy when nothing is supplied', () => {
            // Arrange
            const input = {};

            // Act
            const parsed = OffsetQuerySchema.parse(input);

            // Assert
            expect(parsed).toEqual({ page: 1, size: 20, orderBy: 'createdAt:desc' });
        });

        it('coerces string query values to numbers', () => {
            // Arrange
            const input = { page: '3', size: '50' };

            // Act
            const parsed = OffsetQuerySchema.parse(input);

            // Assert
            expect(parsed).toEqual({ page: 3, size: 50, orderBy: 'createdAt:desc' });
        });

        it('rejects page 0', () => {
            // Arrange
            const input = { page: 0 };

            // Act
            const act = () => OffsetQuerySchema.parse(input);

            // Assert
            expect(act).toThrow();
        });

        it('rejects a size above the max of 100', () => {
            // Arrange
            const input = { size: 101 };

            // Act
            const act = () => OffsetQuerySchema.parse(input);

            // Assert
            expect(act).toThrow();
        });

        it('accepts a size at the max of 100', () => {
            // Arrange
            const input = { size: 100 };

            // Act
            const parsed = OffsetQuerySchema.parse(input);

            // Assert
            expect(parsed.size).toBe(100);
        });

        it('accepts the legitimate single-field orderBy form', () => {
            // Arrange
            const input = { orderBy: 'title:asc' };

            // Act
            const parsed = OffsetQuerySchema.parse(input);

            // Assert
            expect(parsed.orderBy).toBe('title:asc');
        });

        it('rejects an orderBy that tries to smuggle SQL past the whitelist regex', () => {
            // Arrange
            const input = { orderBy: 'createdAt:desc; DROP TABLE' };

            // Act
            const act = () => OffsetQuerySchema.parse(input);

            // Assert
            expect(act).toThrow();
        });

        it('rejects an orderBy with a direction the regex does not allow', () => {
            // Arrange
            const input = { orderBy: 'createdAt:sideways' };

            // Act
            const act = () => OffsetQuerySchema.parse(input);

            // Assert
            expect(act).toThrow();
        });
    });

    describe('CursorQuerySchema', () => {
        it('defaults size and orderBy, with after/before absent', () => {
            // Arrange
            const input = {};

            // Act
            const parsed = CursorQuerySchema.parse(input);

            // Assert
            expect(parsed).toEqual({ size: 20, orderBy: 'createdAt:desc,id:desc' });
        });

        it('accepts an opaque after token', () => {
            // Arrange
            const input = { after: 'opaque-cursor-token' };

            // Act
            const parsed = CursorQuerySchema.parse(input);

            // Assert
            expect(parsed.after).toBe('opaque-cursor-token');
        });

        it('accepts an opaque before token', () => {
            // Arrange
            const input = { before: 'opaque-cursor-token' };

            // Act
            const parsed = CursorQuerySchema.parse(input);

            // Assert
            expect(parsed.before).toBe('opaque-cursor-token');
        });

        it('rejects an empty after token', () => {
            // Arrange
            const input = { after: '' };

            // Act
            const act = () => CursorQuerySchema.parse(input);

            // Assert
            expect(act).toThrow();
        });

        it('rejects a size above the max of 100', () => {
            // Arrange
            const input = { size: 101 };

            // Act
            const act = () => CursorQuerySchema.parse(input);

            // Assert
            expect(act).toThrow();
        });

        it('accepts the single-field orderBy form', () => {
            // Arrange
            const input = { orderBy: 'createdAt:desc' };

            // Act
            const parsed = CursorQuerySchema.parse(input);

            // Assert
            expect(parsed.orderBy).toBe('createdAt:desc');
        });

        it('accepts the two-term orderBy form with the id tiebreaker', () => {
            // Arrange
            const input = { orderBy: 'createdAt:asc,id:asc' };

            // Act
            const parsed = CursorQuerySchema.parse(input);

            // Assert
            expect(parsed.orderBy).toBe('createdAt:asc,id:asc');
        });

        it('rejects an orderBy that tries to smuggle SQL past the whitelist regex', () => {
            // Arrange
            const input = { orderBy: 'createdAt:desc; DROP TABLE' };

            // Act
            const act = () => CursorQuerySchema.parse(input);

            // Assert
            expect(act).toThrow();
        });

        it('rejects a two-term orderBy whose second field is not id', () => {
            // Arrange
            const input = { orderBy: 'createdAt:desc,title:asc' };

            // Act
            const act = () => CursorQuerySchema.parse(input);

            // Assert
            expect(act).toThrow();
        });
    });
});
