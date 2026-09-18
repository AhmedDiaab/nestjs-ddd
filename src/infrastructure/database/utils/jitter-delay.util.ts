import { delay } from '@common/utils';

export const jitterDelay = async (jitterMs: number) => {
    if (jitterMs > 0) await delay(Math.floor(Math.random() * jitterMs));
};
