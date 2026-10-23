import { fileTypeFromFile } from 'file-type';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { validationError } from '../common/app-error';

const allowed = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export async function detectUploadType(filePath: string, originalName: string): Promise<{ mime: string; ext: string }> {
  try {
    const detected = await fileTypeFromFile(filePath);
    if (detected && allowed.has(detected.mime)) return detected;
    // Text has no magic bytes: validate the entire stream, including UTF-8 boundaries.
    if (!detected && path.extname(originalName).toLowerCase() === '.txt') {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      for await (const chunk of createReadStream(filePath)) {
        const text = decoder.decode(chunk, { stream: true });
        for (let index = 0; index < text.length; index += 1) {
          const code = text.charCodeAt(index);
          if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
            throw new Error('Binary data');
          }
        }
      }
      decoder.decode();
      return { mime: 'text/plain', ext: 'txt' };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code) throw error;
  }
  throw validationError('Тип файла не поддерживается.', { file: 'unsupported_type' });
}
