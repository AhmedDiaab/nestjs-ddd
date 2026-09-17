import type { ThrottlerStorage } from '@nestjs/throttler';
import { createToken } from '@shared';

/** Rate-limit counter storage; `null` means the throttler's default in-memory storage. */
export const ThrottlerStorageToken = createToken<ThrottlerStorage | null>('ThrottlerStorage');
