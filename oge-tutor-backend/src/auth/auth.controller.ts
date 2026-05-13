import { Body, Controller, Post } from '@nestjs/common';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';
import { BootstrapService } from '../bootstrap/bootstrap.service';
import { validateEmail } from '../common/validation';
import { logDomain } from '../common/app-logger';
import { LoginDto, PasswordResetDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly bootstrap: BootstrapService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() body: LoginDto) {
    const user = await this.auth.validateCredentials(body.email, body.password);
    const session = await this.auth.signSession(user);
    return { session, data: await this.bootstrap.buildForUser(user.id) };
  }

  @Post('logout')
  logout() {
    return { session: null };
  }

  @Public()
  @Post('password-reset')
  requestPasswordReset(@Body() body: PasswordResetDto) {
    const email = validateEmail(body.email);
    logDomain('auth.password_reset.requested', { email });
    return { passwordReset: { email, accepted: true } };
  }
}
