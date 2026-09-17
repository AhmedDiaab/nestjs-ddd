import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { formatZodError } from '../interceptors/zod-http.interceptor';

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
