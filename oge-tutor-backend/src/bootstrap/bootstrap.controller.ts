import { Controller, Get } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/current-user';
import { BootstrapService } from './bootstrap.service';

@Controller('bootstrap')
export class BootstrapController {
  constructor(private readonly bootstrap: BootstrapService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    return {
      session: await this.bootstrap.buildSessionForUser(user.id),
      data: await this.bootstrap.buildForUser(user.id),
    };
  }
}
