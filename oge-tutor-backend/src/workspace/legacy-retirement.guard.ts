import { CanActivate, Controller, ExecutionContext, Get, Injectable, OnModuleInit } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/public.decorator';
import { AppError } from '../common/app-error';
import { isLegacyRequestAllowed, isLegacyRoute, legacyApiMode } from './legacy-mode';
import { recordLegacyRequest } from '../observability/metrics';

@Injectable()
export class LegacyRetirementGuard implements CanActivate, OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}
  async onModuleInit() {
    const barrier = await this.prisma.legacyCutover.findUnique({ where: { id: 'v2-authoritative' } });
    if (legacyApiMode() !== 'disabled' && barrier) throw new Error('Legacy cutover is committed. Re-enabling v1 requires a verified restore, not a configuration rollback.');
    if (legacyApiMode() === 'disabled') await this.prisma.legacyCutover.upsert({ where: { id: 'v2-authoritative' }, create: { id: 'v2-authoritative' }, update: {} });
  }
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ path: string; method: string }>();
    if (!isLegacyRoute(req.path)) return true;
    const res = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', '</api/docs>; rel="successor-version"');
    const mode = legacyApiMode();
    recordLegacyRequest(mode);
    if (!isLegacyRequestAllowed(req.path, req.method, mode)) throw new AppError(mode === 'disabled' ? 410 : 403,
      mode === 'disabled' ? 'legacy_api_disabled' : 'legacy_api_read_only',
      mode === 'disabled' ? 'Старый API отключён. Используйте рабочие пространства.' : 'Старый API доступен только для чтения.');
    return true;
  }
}

@ApiTags('v2-runtime')
@Controller('api/v2/runtime')
export class RuntimeController {
  @Public() @Get()
  get() { return { apiVersion: 2, legacyApiMode: legacyApiMode(), legacyDataRetained: true }; }
}
