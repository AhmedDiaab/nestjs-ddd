import { delay } from './delay.util';

export const jitterDelay = async (jitterMs: number) => {
    if (jitterMs > 0) await delay(Math.floor(Math.random() * jitterMs));
};
