import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AccessTokenService } from './access-token.service';
import { AuthMailerService } from './auth-mailer.service';
import { AuthService } from './auth.service';
import { BootstrapModule } from '../bootstrap/bootstrap.module';

@Module({
  imports: [JwtModule.register({}), BootstrapModule],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenService, AuthMailerService],
  exports: [AuthService, AccessTokenService, AuthMailerService],
})
export class AuthModule {}
