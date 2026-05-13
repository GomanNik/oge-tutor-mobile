/*
 * OGE Tutor Backend — application entry point.
 * Configures validation, CORS, static uploads, Swagger, HTTP error mapping and no-cache API headers.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationError, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/http-error.filter';
import { validationError } from './common/app-error';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false });
  const config = app.get(ConfigService);

  const uploadDir = config.get<string>('UPLOAD_DIR') || 'uploads';
  const uploadPath = path.resolve(process.cwd(), uploadDir);
  fs.mkdirSync(uploadPath, { recursive: true });

  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter.getInstance?.();
  if (instance?.set) instance.set('etag', false);

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/uploads', express.static(uploadPath));

  app.enableCors({
    origin: config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:5173',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidUnknownValues: false,
    exceptionFactory: (errors: ValidationError[]) => {
      const fieldErrors = errors.reduce<Record<string, string>>((acc, error) => {
        acc[error.property] = Object.values(error.constraints || {}).join('; ') || 'invalid';
        return acc;
      }, {});
      return validationError('Проверьте заполненные поля.', fieldErrors);
    },
  }));
  app.useGlobalFilters(new HttpErrorFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('OGE Tutor Backend API')
    .setDescription('Backend contract for the OGE Tutor frontend')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = Number(config.get('PORT') || 3000);
  await app.listen(port);
  console.log(`OGE Tutor backend is running on http://localhost:${port}`);
}

void bootstrap();
