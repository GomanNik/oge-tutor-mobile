import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { LearningProgressService } from '../learning/learning-progress.service';
import { LearningDeliveryWorker } from '../learning/learning-delivery.worker';

async function main() {
  const command = process.argv[2];
  if (!['rebuild-progress', 'deliver'].includes(command)) throw new Error('Usage: learning:operator rebuild-progress|deliver');
  process.env.LEARNING_NOTIFICATIONS_WORKER_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const count = command === 'rebuild-progress' ? await app.get(LearningProgressService).rebuildProgress() : await app.get(LearningDeliveryWorker).runBatch(50);
    process.stdout.write(`${JSON.stringify({ command, count })}\n`);
  } finally { await app.close(); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Learning operation failed'}\n`); process.exitCode = 1; });
