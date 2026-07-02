import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async readiness() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, status: 'ready', checks: { database: 'ok' } };
  }
}
