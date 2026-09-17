export const withTimeout = async <T>(p: Promise<T>, ms: number, tag?: string): Promise<T> => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>(
        (_, rej) =>
            (t = setTimeout(() => rej(new Error(`Timeout ${ms}ms${tag ? `: ${tag}` : ''}`)), ms)),
    );
    try {
        return await Promise.race([p, timeout]);
    } finally {
        if (t) clearTimeout(t);
    }
};
