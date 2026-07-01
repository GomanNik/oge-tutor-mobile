/*
 * OGE Tutor Backend — bootstrap module.
 * Exposes BootstrapService globally because feature controllers use it to return frontend-compatible state after mutations.
 */
import { Global, Module } from '@nestjs/common';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';

@Global()
@Module({
  controllers: [BootstrapController],
  providers: [BootstrapService],
  exports: [BootstrapService],
})
export class BootstrapModule {}
