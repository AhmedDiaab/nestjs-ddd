import { createToken } from '@shared';
import type { HttpClient } from './contracts';

export const HttpClientToken = createToken<HttpClient>('HttpClient');
