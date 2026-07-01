import { ConfigService } from '@nestjs/config';

export function buildFileDownloadUrl(config: ConfigService, fileId: string): string {
  const publicBase = config.get<string>('PUBLIC_BACKEND_URL') || `http://localhost:${config.get('PORT') || 3000}`;
  return `${publicBase.replace(/\/$/, '')}/files/${encodeURIComponent(fileId)}/download`;
}
