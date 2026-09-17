/** Source keys used by DAOs. Must match `key` entries in DATABASE_CONFIG_JSON. */
export const DatabaseSources = {
    main: 'main',
} as const;

export type DatabaseSourceKey = (typeof DatabaseSources)[keyof typeof DatabaseSources];
