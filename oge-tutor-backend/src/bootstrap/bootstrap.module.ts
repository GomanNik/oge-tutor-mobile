/*
 * OGE Tutor Backend — bootstrap module.
 * Exposes BootstrapService globally because feature controllers use it to return frontend-compatible state after mutations.
 */
import { Global, Module } from '@nestjs/common';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';
import { CatalogController } from '../catalog/catalog.controller';
import { CatalogService } from '../catalog/catalog.service';

@Global()
@Module({
  controllers: [BootstrapController, CatalogController],
  providers: [BootstrapService, CatalogService],
  exports: [BootstrapService, CatalogService],
})
export class BootstrapModule {}
