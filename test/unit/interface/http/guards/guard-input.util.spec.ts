import { BadRequestError } from '@application/errors';
import { readGuardInput } from '@interface/http/guards';
import type { ExecutionContext } from '@nestjs/common';
import { z } from 'zod';

const contextWith = (request: Record<string, unknown>) =>
    ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('readGuardInput', () => {
    const paramsSchema = z.object({ siteName: z.string().trim().min(1) });

    it('returns the parsed value of the requested part', () => {
        // Arrange
        const context = contextWith({ params: { siteName: '  CAI_001 ' } });

        // Act
        const params = readGuardInput(context, 'params', paramsSchema);

        // Assert
        expect(params).toEqual({ siteName: 'CAI_001' });
    });

    it('throws BadRequestError naming only the part when validation fails', () => {
        // Arrange
        const context = contextWith({ params: { siteName: '   ' } });

        // Act
        let error: unknown;
        try {
            readGuardInput(context, 'params', paramsSchema);
        } catch (e) {
            error = e;
        }

        // Assert
        expect(error).toBeInstanceOf(BadRequestError);
        expect((error as BadRequestError).message).toBe('Invalid request params');
    });

    it.each([
        ['query', { page: '2' }, z.object({ page: z.coerce.number() }), { page: 2 }],
        ['body', { note: 'x' }, z.object({ note: z.string() }), { note: 'x' }],
    ] as const)('reads %s the same way', (part, raw, schema, expected) => {
        // Arrange
        const context = contextWith({ [part]: raw });

        // Act
        const value = readGuardInput<unknown>(context, part, schema);

        // Assert
        expect(value).toEqual(expected);
    });
});
