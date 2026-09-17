import { JwtStrategy } from '@infrastructure/auth/strategies';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

/** Verifies incoming JWTs (issued elsewhere). Add JwtModule here only if this service signs tokens. */
@Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    providers: [JwtStrategy],
    exports: [JwtStrategy],
})
export class AuthModule {}
