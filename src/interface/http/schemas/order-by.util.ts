import { z } from 'zod';

const orderDir = z.enum(['asc', 'desc']);

/** Parses "field:dir[,field2:dir]" into parts; map fields through a whitelist before building SQL. */
export type OrderByPart = { field: string; dir: 'asc' | 'desc' };

export function parseOrderBy(input: string): OrderByPart[] {
    return input.split(',').map((seg) => {
        const [field, dir] = seg.split(':');
        return { field, dir: orderDir.parse(dir) };
    });
}
