import type { Maybe, Nullable } from '@shared';
import type { Lob } from 'oracledb';

export async function lobToString(lob: Maybe<Lob>): Promise<Nullable<string>> {
    if (!lob) {
        return null;
    }

    let data = '';

    lob.setEncoding('utf8');

    for await (const chunk of lob) {
        data += chunk;
    }

    return data;
}
