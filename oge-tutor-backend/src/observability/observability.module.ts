import { Module } from '@nestjs/common';
import { MetricsController } from './metrics';

@Module({ controllers: [MetricsController] })
export class ObservabilityModule {}
