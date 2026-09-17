export interface JWTPayload {
    id: string;
    username: string;
    admin: boolean;
    /** Roles carried by the token, when the issuer puts them there. Checked by `RolesGuard`. */
    roles?: readonly string[];
    email: string;
    name: string;
    iat: number;
    exp: number;
}
