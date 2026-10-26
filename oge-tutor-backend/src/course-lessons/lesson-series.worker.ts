import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LessonSeriesService } from './lesson-series.service';

@Injectable()
export class LessonSeriesWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(LessonSeriesWorker.name);
  constructor(private readonly prisma: PrismaService, private readonly series: LessonSeriesService, private readonly config: ConfigService) {}
  onModuleInit() {
    if (process.env.CLI_MODE === 'true' || this.config.get('NODE_ENV') === 'test' || this.config.get('LESSON_SERIES_WORKER_ENABLED') === 'false') return;
    this.timer = setInterval(() => { void this.runBatch().catch(() => this.logger.error('Lesson series sweep failed.')); }, 60000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async runBatch(limit = 10) {
    if (this.running) return { handled: 0, created: 0 };
    this.running = true;
    try {
      const rows = await this.prisma.lessonSeries.findMany({ where: { status: 'active', nextRunAt: { lte: new Date() } }, orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }], take: Math.min(50, Math.max(1, limit)), select: { id: true } });
      let created = 0;
      for (const row of rows) created += await this.series.materializeWorker(row.id);
      return { handled: rows.length, created };
    } finally { this.running = false; }
  }
}
