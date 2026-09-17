export interface JWTPayload {
    id: string;
    username: string;
    admin: boolean;
    email: string;
    name: string;
    iat: number;
    exp: number;
}
