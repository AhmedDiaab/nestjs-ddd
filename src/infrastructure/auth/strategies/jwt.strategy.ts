import type { ConfigPort } from '@application/ports';
import { ConfigPortToken } from '@application/ports';
import type { JWTPayload } from '@domain/auth';
import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(@Inject(ConfigPortToken) config: ConfigPort) {
        const jwt = config.get('jwt');
        const options: StrategyOptionsWithoutRequest = {
            // cookie first, then "Authorization: Bearer"
            jwtFromRequest: ExtractJwt.fromExtractors([
                (req: Request) =>
                    (req?.cookies as Record<string, string> | undefined)?.[jwt.cookieName] ?? null,
                ExtractJwt.fromAuthHeaderAsBearerToken(),
            ]),
            ignoreExpiration: false,
            secretOrKey: jwt.secret,
            algorithms: jwt.algorithms,
            issuer: jwt.issuer,
            audience: jwt.audience,
        };
        super(options);
    }

    validate(payload: JWTPayload) {
        return payload;
    }
}
