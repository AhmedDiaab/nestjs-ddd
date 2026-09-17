export function formatError(stack?: string): string {
    return (stack?.split('\n') ?? [])
        .map((line) => line.trim())
        .filter(
            (line) =>
                line.startsWith('at') &&
                !line.includes('node_modules') &&
                !line.includes('node:internal'),
        )
        .join('\n');
}
