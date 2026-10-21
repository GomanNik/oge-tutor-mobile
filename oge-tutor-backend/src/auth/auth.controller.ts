import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard, minutes } from '@nestjs/throttler';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';
import { AccessTokenService } from './access-token.service';
import { BootstrapService } from '../bootstrap/bootstrap.service';
import { AccessTokenCompleteDto, AccessTokenVerifyDto, LoginDto, PasswordResetDto } from './auth.dto';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accessTokens: AccessTokenService,
    private readonly bootstrap: BootstrapService,
  ) {}

  @Public()
  @Post('login')
  @Throttle({ target: { limit: 8, ttl: minutes(15) } })
  async login(@Body() body: LoginDto) {
    const user = await this.auth.validateCredentials(body.email, body.password);
    const session = await this.auth.signSession(user);
    return { session, data: await this.bootstrap.buildForUser(user.id) };
  }

  @Post('logout')
  @SkipThrottle({ ip: true, target: true })
  logout() {
    return { session: null };
  }

  @Public()
  @Post('password-reset')
  @Throttle({ ip: { limit: 10, ttl: minutes(1) }, target: { limit: 3, ttl: minutes(15) } })
  async requestPasswordReset(@Body() body: PasswordResetDto) {
    return this.auth.requestPasswordReset(body.email);
  }

  @Public()
  @Post('access-token/verify')
  @Throttle({ target: { limit: 10, ttl: minutes(15) } })
  async verifyAccessToken(@Body() body: AccessTokenVerifyDto) {
    return this.accessTokens.verify(body.token);
  }

  @Public()
  @Post('access-token/complete')
  @Throttle({ ip: { limit: 20, ttl: minutes(1) }, target: { limit: 5, ttl: minutes(15) } })
  async completeAccessToken(@Body() body: AccessTokenCompleteDto) {
    return this.accessTokens.complete(body.token, body.password);
  }
}
