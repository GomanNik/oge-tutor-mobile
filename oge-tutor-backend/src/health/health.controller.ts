import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  healthcheck() {
    return { ok: true, status: 'ok' };
  }

  @Get('ready')
  readiness() {
    return this.health.readiness();
  }
}
