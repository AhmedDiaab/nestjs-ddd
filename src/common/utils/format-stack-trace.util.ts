export function formatStackTrace(stack?: string): string | undefined {
    if (!stack) return undefined;

    // Split by newlines, remove empty lines
    const lines = stack
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

    // Keep only relevant frames (your app src/)
    const filtered = lines.filter(
        (line) =>
            line.includes('/src/') && // show only your source files
            !line.includes('node_modules') && // hide libraries
            !line.includes('(internal') && // hide node internals
            !line.includes('processTicksAndRejections'),
    );

    // Take top 3 frames (configurable)
    const topFrames = filtered.slice(0, 3);

    // Add a clear separator
    return topFrames.length ? topFrames.join('\n') : lines.slice(0, 3).join('\n'); // fallback: first 3 lines if no src/ found
}
