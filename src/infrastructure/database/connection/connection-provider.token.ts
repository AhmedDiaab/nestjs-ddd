import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { createToken } from '@shared';

export const ConnectionProviderToken = createToken<ConnectionProvider>('ConnectionProvider');
