import { Body, Controller, Post } from '@nestjs/common';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';
import { AccessTokenService } from './access-token.service';
import { BootstrapService } from '../bootstrap/bootstrap.service';
import { AccessTokenCompleteDto, AccessTokenVerifyDto, LoginDto, PasswordResetDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accessTokens: AccessTokenService,
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
  async requestPasswordReset(@Body() body: PasswordResetDto) {
    return this.auth.requestPasswordReset(body.email);
  }

  @Public()
  @Post('access-token/verify')
  async verifyAccessToken(@Body() body: AccessTokenVerifyDto) {
    return this.accessTokens.verify(body.token);
  }

  @Public()
  @Post('access-token/complete')
  async completeAccessToken(@Body() body: AccessTokenCompleteDto) {
    return this.accessTokens.complete(body.token, body.password);
  }
}
