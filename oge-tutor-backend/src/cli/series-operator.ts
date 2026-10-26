import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { LessonSeriesWorker } from '../course-lessons/lesson-series.worker';

async function main() {
  if (process.argv[2] !== 'materialize') throw new Error('Usage: series:operator materialize');
  process.env.CLI_MODE = 'true';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try { process.stdout.write(`${JSON.stringify(await app.get(LessonSeriesWorker).runBatch(50))}\n`); }
  finally { await app.close(); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Series operation failed'}\n`); process.exitCode = 1; });
