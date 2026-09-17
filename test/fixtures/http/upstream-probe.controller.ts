import { HttpClientToken, type HttpClient } from '@infrastructure/http';
import { Public } from '@interface/http/decorators';
import { Controller, Get, Inject } from '@nestjs/common';

/** Calls an upstream through the shared client, so a test can inspect what it sent. */
@Public()
@Controller('e2e-upstream')
export class UpstreamProbeController {
    static upstreamUrl = '';

    constructor(@Inject(HttpClientToken) private readonly http: HttpClient) {}

    @Get()
    async call() {
        const response = await this.http.request<{ seenHeaders: Record<string, string> }>({
            method: 'GET',
            url: UpstreamProbeController.upstreamUrl,
            tag: 'e2e.upstream',
        });

        return response.body;
    }
}
