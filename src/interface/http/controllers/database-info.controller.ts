import { GetDatabaseInfoUseCase } from '@application/use-cases';
import type { JWTPayload } from '@domain/auth';
import { CurrentUser } from '@interface/http/decorators';
import { JwtGuard } from '@interface/http/guards';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { BEARER_SECURITY, COOKIE_SECURITY } from '../swagger/swagger.constants';

/**
 * Example endpoint: the authenticated username flows
 * controller → use case → repository port → DAO `contextUser` → Oracle CLIENT_IDENTIFIER.
 * Response shows the identifier the database saw.
 */
@ApiTags('examples')
@ApiBearerAuth(BEARER_SECURITY)
@ApiCookieAuth(COOKIE_SECURITY)
@UseGuards(JwtGuard)
@Controller('database-info')
export class DatabaseInfoController {
    constructor(private readonly getDatabaseInfo: GetDatabaseInfoUseCase) {}

    @Get()
    get(@CurrentUser() user: JWTPayload) {
        return this.getDatabaseInfo.execute({ username: user.username });
    }
}
