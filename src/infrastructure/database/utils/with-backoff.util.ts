export const expoBackoff = (attempt: number, baseMs = 200, jitterMs = 150) => {
    const pow = Math.pow(2, attempt); // 1,2,4,8...
    const jitter = Math.floor(Math.random() * jitterMs);
    return pow * baseMs + jitter;
};
