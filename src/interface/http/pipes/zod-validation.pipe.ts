// interface/http/pipes/zod-validation.pipe.ts
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodType } from 'zod';

type Options = { async?: boolean };

@Injectable()
export class ZodValidationPipe implements PipeTransform {
    constructor(
        private readonly schema: ZodType,
        private readonly opts: Options = {},
    ) {}

    async transform(value: unknown) {
        const parsed = this.opts.async
            ? await this.schema.safeParseAsync(value)
            : this.schema.safeParse(value);

        if (!parsed.success) {
            throw new BadRequestException(formatZodError(parsed.error));
        }
        return parsed.data;
    }
}

function formatZodError(error: ZodError) {
    const details = error.issues.map((i) => {
        const path = i.path.join('.');
        return path ? `${path}: ${i.message}` : i.message;
    });
    return { message: 'Validation failed', details };
}
