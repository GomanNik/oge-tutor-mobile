import { Controller, Get } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user';
import { BootstrapService } from './bootstrap.service';
import { CatalogService } from '../catalog/catalog.service';

@Controller('bootstrap')
export class BootstrapController {
  constructor(private readonly bootstrap: BootstrapService, private readonly catalog: CatalogService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    return {
      session: await this.bootstrap.buildSessionForUser(user.id),
      ...await this.catalog.initial(user),
    };
  }
}
