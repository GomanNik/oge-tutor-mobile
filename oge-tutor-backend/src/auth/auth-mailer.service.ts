import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessTokenType } from '../common/contracts';
import { isProduction } from './auth-config';
import { AccessTokenPreview } from './access-token.service';

export type AccessTokenMailResult = {
  status: 'dev_preview' | 'not_configured';
  provider: 'noop';
};

@Injectable()
export class AuthMailerService {
  private readonly logger = new Logger(AuthMailerService.name);

  constructor(private readonly config: ConfigService) {}

  async sendAccessTokenLink(params: {
    email: string;
    type: AccessTokenType;
    preview?: AccessTokenPreview;
  }): Promise<AccessTokenMailResult> {
    const configuredProvider = this.config.get<string>('MAILER_PROVIDER');
    if (isProduction(this.config)) {
      this.logger.warn(
        configuredProvider
          ? `Mailer provider "${configuredProvider}" is configured but not implemented in this build. Access link was not sent.`
          : 'Mailer provider is not configured. Access link was not sent.',
      );
      return { status: 'not_configured', provider: 'noop' };
    }

    this.logger.debug(`Dev mailer prepared ${params.type} link for ${params.email}.`);
    return { status: 'dev_preview', provider: 'noop' };
  }
}
