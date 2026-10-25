import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import type { NextFunction, Request, Response } from 'express';
import { HttpErrorFilter } from '../../src/common/http-error.filter';
import { ACCESS_STATUS, ROLE } from '../../src/common/contracts';
import { createValidationPipe } from '../../src/common/validation-pipe';
import { createApiDocument } from '../../src/swagger/api-document';
import { ensureLegacyStudent, ensureLegacyTeacher } from '../../src/workspace/legacy';
import { AuthMailerService } from '../../src/auth/auth-mailer.service';
import { WorkspaceInvitationsService } from '../../src/workspace/workspace-invitations.service';

const databaseUrl = process.env.E2E_DATABASE_URL || '';
const describeIfDb = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  console.warn('Skipping AppModule e2e tests: E2E_DATABASE_URL is not configured.');
}

function assertSafeTestDatabase(url: string) {
  if (!/(test|e2e|ci)/i.test(url)) {
    throw new Error('E2E_DATABASE_URL must clearly point to a test/e2e/ci database.');
  }
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describeIfDb('AppModule e2e production flows', () => {
  let app: INestApplication;
  let prisma: any;
  let server: any;
  let uploadDir: string;
  const contractFailures: string[] = [];

  beforeAll(async () => {
    assertSafeTestDatabase(databaseUrl);
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oge-tutor-e2e-'));

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'e2e-test-secret';
    process.env.PUBLIC_BACKEND_URL = 'http://127.0.0.1:3000';
    process.env.APP_FRONTEND_URL = 'http://127.0.0.1:5173';
    process.env.FRONTEND_ORIGIN = 'http://127.0.0.1:5173';
    process.env.MAILER_PROVIDER = 'noop';
    process.env.METRICS_TOKEN = 'test-metrics-token-longer-than-32-characters';
    process.env.UPLOAD_DIR = uploadDir;

    const { AppModule } = await import('../../src/app.module');
    const { PrismaService } = await import('../../src/prisma/prisma.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new HttpErrorFilter());
    let verifyResponse: ((method: string, path: string, status: number, body: unknown) => void) | undefined;
    app.use((req: Request, res: Response, next: NextFunction) => {
      const original = res.json.bind(res);
      res.json = (body: any) => {
        if (req.path.startsWith('/api/v2/')) {
          try { verifyResponse?.(req.method.toLowerCase(), req.path, res.statusCode, JSON.parse(JSON.stringify(body))); }
          catch (error) { contractFailures.push(String(error)); }
        }
        return original(body);
      };
      next();
    });
    await app.init();

    const document = createApiDocument(app);
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    const toJsonSchema = (value: any): any => {
      if (Array.isArray(value)) return value.map(toJsonSchema);
      if (!value || typeof value !== 'object') return value;
      const converted = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'nullable')
        .map(([key, entry]) => [key, toJsonSchema(entry)]));
      return value.nullable ? { anyOf: [converted, { type: 'null' }] } : converted;
    };
    const components = toJsonSchema(document.components.schemas);
    const validators = new Map<string, ReturnType<typeof ajv.compile>>();
    for (const [route, pathItem] of Object.entries(document.paths)) {
      if (!route.startsWith('/api/v2/')) continue;
      for (const method of ['get', 'post', 'patch', 'delete'] as const) {
        const operation = pathItem[method];
        if (!operation) continue;
        for (const [status, response] of Object.entries(operation.responses)) {
          const schema = response.content?.['application/json']?.schema;
          if (schema) validators.set(`${method} ${route} ${status}`, ajv.compile({ ...toJsonSchema(schema), components: { schemas: components } }));
        }
      }
    }
    verifyResponse = (method, pathname, status, body) => {
      const route = Object.keys(document.paths).find(candidate => candidate.startsWith('/api/v2/')
        && new RegExp(`^${candidate.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(pathname)
        && document.paths[candidate][method as 'get'] !== undefined);
      const key = `${method} ${route} ${status}`;
      const validator = validators.get(key);
      if (!validator) throw new Error(`Missing OpenAPI response schema: ${key}`);
      if (!validator(body)) throw new Error(`Response violates ${key}: ${ajv.errorsText(validator.errors)}`);
    };

    prisma = app.get(PrismaService);
    server = app.getHttpServer();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Workspace", "Notification", "ProgressHistory", "StudentTaskProgress", "MaterialAttachment", "MaterialTopic", "HomeworkSubmission", "Homework", "Lesson", "FileResource", "AccessToken", "StudentProfile", "TeacherProfile", "User" RESTART IDENTITY CASCADE');
    // TRUNCATE CASCADE also removes the global catalog because its tables contain optional workspace FKs.
    await prisma.subject.create({ data: { id: 'legacy-subject-math', scopeKey: 'global', code: 'math', name: 'Математика' } });
    await prisma.examProgram.create({ data: { id: 'legacy-program-oge-math', scopeKey: 'global', subjectId: 'legacy-subject-math', code: 'oge-math', examType: 'oge', variant: 'general', name: 'ОГЭ · математика' } });
    await prisma.programVersion.create({ data: { id: 'legacy-version-oge-math', programId: 'legacy-program-oge-math', period: 'legacy-import', revisionNumber: 1, status: 'published', publishedAt: new Date() } });

    const initialTeacher = await prisma.user.create({
      data: {
        email: 'teacher-e2e@mail.ru',
        role: ROLE.TEACHER,
        displayName: 'E2E Teacher',
        passwordHash: await bcrypt.hash('teacherpass', 4),
        teacherProfile: {
          create: {
            name: 'E2E Teacher',
            settings: {},
          },
        },
      },
      include: { teacherProfile: true },
    });
    await ensureLegacyTeacher(prisma, initialTeacher.teacherProfile.id);
  });

  afterAll(async () => {
    await app?.close();
    if (uploadDir) fs.rmSync(uploadDir, { recursive: true, force: true });
    expect(contractFailures).toEqual([]);
  });

  it('documents every HTTP route with an explicit success response schema', () => {
    const document = createApiDocument(app);
    let operations = 0;
    for (const [route, pathItem] of Object.entries(document.paths)) {
      for (const method of ['get', 'post', 'patch', 'delete'] as const) {
        const operation = pathItem[method];
        if (!operation) continue;
        operations += 1;
        const success = Object.entries(operation.responses).find(([status]) => /^2\d\d$/.test(status));
        expect(success, `${method.toUpperCase()} ${route} has no success response`).toBeDefined();
        if (success?.[0] !== '204') expect(success?.[1].content, `${method.toUpperCase()} ${route} has no response schema`).toBeDefined();
        if (method === 'post' || method === 'patch') {
          if (route !== '/auth/logout' && route !== '/api/v2/auth/logout' && route !== '/notifications/read-all') {
            expect(operation.requestBody, `${method.toUpperCase()} ${route} has no request schema`).toBeDefined();
          }
        }
      }
    }
    expect(operations).toBeGreaterThanOrEqual(45);
    const memberPath = document.paths['/api/v2/workspaces/{workspaceId}/members'];
    expect(memberPath.get?.responses['200'].content?.['application/json'].schema).toEqual({ $ref: '#/components/schemas/V2MemberPage' });
    expect(document.components.schemas.V2Member.properties).not.toHaveProperty('passwordHash');
    expect(document.components.schemas.V2Invitation.properties).not.toHaveProperty('tokenHash');
    expect(document.components.schemas.V2ProgramVersion.properties?.program).toEqual({ $ref: '#/components/schemas/V2Program' });
    expect(document.paths['/api/v2/program-versions/{id}'].get?.responses['200'].content?.['application/json'].schema).toEqual({ $ref: '#/components/schemas/V2ProgramVersionDetail' });
    const update = document.paths['/api/v2/workspaces/{workspaceId}/members/{memberId}'].patch;
    expect(update?.responses).toHaveProperty('412');
    expect(update?.responses).toHaveProperty('428');
    expect(update?.parameters?.some(parameter => !('$ref' in parameter) && parameter.name === 'If-Match' && parameter.required)).toBe(true);
    const lessonCreate = document.paths['/api/v2/workspaces/{workspaceId}/lessons'].post;
    const lessonCancel = document.paths['/api/v2/workspaces/{workspaceId}/lessons/{id}/cancel'].post;
    expect(lessonCreate?.parameters?.some(parameter => !('$ref' in parameter) && parameter.name === 'Idempotency-Key' && parameter.required)).toBe(true);
    expect(lessonCancel?.parameters?.some(parameter => !('$ref' in parameter) && parameter.name === 'If-Match' && parameter.required)).toBe(true);
    expect(lessonCancel?.responses).toHaveProperty('412');
    expect(lessonCancel?.responses).toHaveProperty('428');
  });

  it('runs auth, bootstrap, invite, lesson, homework, file and reset flows through HTTP', async () => {
    await request(server).get('/health').expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ ok: true, status: 'ok' });
    });

    const teacherLogin = await request(server)
      .post('/auth/login')
      .send({ email: 'teacher-e2e@mail.ru', password: 'teacherpass' })
      .expect(201);
    const teacherToken = teacherLogin.body.session.token;
    const teacherId = teacherLogin.body.session.id;

    await request(server)
      .get('/bootstrap')
      .set(auth(teacherToken))
      .expect(200)
      .expect(({ body }) => {
        expect(body.session.role).toBe(ROLE.TEACHER);
      });

    const createdStudent = await request(server)
      .post('/students')
      .set(auth(teacherToken))
      .send({ email: 'student-e2e@mail.ru', name: 'E2E Student', grade: '9', note: 'e2e note' })
      .expect(201);
    const inviteToken = createdStudent.body.invite.token;
    const studentId = createdStudent.body.changes.students[0].id;
    expect(inviteToken).toBeTruthy();

    await request(server)
      .post('/auth/login')
      .send({ email: 'student-e2e@mail.ru', password: 'studentpass' })
      .expect(401);

    await request(server)
      .post('/auth/access-token/verify')
      .send({ token: inviteToken })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({ valid: true, type: 'invite' });
        expect(body.account.email).toContain('@');
      });

    await request(server)
      .post('/auth/access-token/complete')
      .send({ token: inviteToken, password: 'studentpass' })
      .expect(201)
      .expect(({ body }) => expect(body).toEqual({ ok: true }));

    await request(server)
      .post('/auth/access-token/complete')
      .send({ token: inviteToken, password: 'studentpass2' })
      .expect(409);

    const activated = await prisma.studentProfile.findUnique({ where: { id: studentId } });
    expect(activated.access).toBe(ACCESS_STATUS.ACTIVE);

    const studentLogin = await request(server)
      .post('/auth/login')
      .send({ email: 'student-e2e@mail.ru', password: 'studentpass' })
      .expect(201);
    const studentToken = studentLogin.body.session.token;

    await request(server)
      .get('/bootstrap')
      .set(auth(studentToken))
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.students).toHaveLength(1);
        expect(body.data.students[0].id).toBe(studentId);
      });

    const uploadedMaterial = await request(server)
      .post('/files')
      .set(auth(teacherToken))
      .field('title', 'Theory')
      .field('context', 'lesson-material')
      .attach('file', Buffer.from('material'), 'material.txt')
      .expect(201);
    const materialFileId = uploadedMaterial.body.fileResource.id;
    const beforeRejectedUpload = await prisma.fileResource.count();
    await request(server)
      .post('/files')
      .set(auth(teacherToken))
      .attach('file', Buffer.from([0, 1, 2, 3]), 'not-a-pdf.pdf')
      .expect(422);
    expect(await prisma.fileResource.count()).toBe(beforeRejectedUpload);

    const startAt = new Date(Date.now() + 60 * 60 * 1000);
    const endAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    await request(server)
      .post('/lessons')
      .set(auth(teacherToken))
      .send({
        studentId,
        topic: 'Past lesson',
        startAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        timezone: 'Europe/Moscow',
      })
      .expect(422);

    const lessonCreated = await request(server)
      .post('/lessons')
      .set(auth(teacherToken))
      .send({
        studentId,
        topic: 'E2E Lesson',
        focusTaskNumbers: [6],
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        timezone: 'Europe/Moscow',
        materials: [{ type: 'file', fileId: materialFileId, title: 'Theory' }],
      })
      .expect(201);
    const lessonId = lessonCreated.body.changes.lessons[0].id;

    await request(server)
      .post('/lessons')
      .set(auth(teacherToken))
      .send({
        studentId,
        topic: 'Conflicting lesson',
        startAt: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 150 * 60 * 1000).toISOString(),
        timezone: 'Europe/Moscow',
      })
      .expect(409);

    await request(server)
      .get(`/files/${materialFileId}/download`)
      .set(auth(studentToken))
      .expect(200);

    await request(server)
      .post(`/lessons/${lessonId}/complete`)
      .set(auth(teacherToken))
      .send({ focusTaskNumbers: [6], completionComment: 'Too early' })
      .expect(422);
    await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        startAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await request(server)
      .post(`/lessons/${lessonId}/complete`)
      .set(auth(teacherToken))
      .send({ focusTaskNumbers: [6], completionComment: 'Done' })
      .expect(201);

    await request(server)
      .post(`/lessons/${lessonId}/complete`)
      .set(auth(teacherToken))
      .send({ focusTaskNumbers: [6], completionComment: 'Duplicate' })
      .expect(409);

    const historyPage = await request(server)
      .get(`/students/${studentId}/progress/history?page=1&pageSize=1&taskNumber=6`)
      .set(auth(teacherToken))
      .expect(200);
    expect(historyPage.body.total).toBe(1);
    expect(historyPage.body.items[0].source).toBe('lesson_completed');
    await request(server)
      .get(`/students/${studentId}/progress/history?page=1&pageSize=1`)
      .set(auth(studentToken))
      .expect(200);

    const assessmentNotice = await prisma.notification.findFirst({ where: { teacherId, studentId } });
    await request(server)
      .patch(`/notifications/${assessmentNotice.id}`)
      .set(auth(studentToken))
      .send({ status: 'read' })
      .expect(403);
    await request(server)
      .patch(`/notifications/${assessmentNotice.id}`)
      .set(auth(teacherToken))
      .send({ status: 'read' })
      .expect(200);
    await request(server)
      .post('/notifications/read-all')
      .set(auth(teacherToken))
      .expect(201);

    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const homeworkCreated = await request(server)
      .post('/homeworks')
      .set(auth(teacherToken))
      .send({
        studentId,
        title: 'E2E Homework',
        taskNumbers: [6],
        dueAt: dueAt.toISOString(),
      })
      .expect(201);
    const homeworkId = homeworkCreated.body.changes.homeworks[0].id;

    const unsentHomework = await request(server)
      .post('/homeworks')
      .set(auth(teacherToken))
      .send({
        studentId,
        title: 'Unsent Homework',
        taskNumbers: [7],
        dueAt: dueAt.toISOString(),
      })
      .expect(201);
    await request(server)
      .post(`/homeworks/${unsentHomework.body.changes.homeworks[0].id}/review`)
      .set(auth(teacherToken))
      .send({ status: 'reviewed', comment: 'Too early' })
      .expect(409);

    await request(server)
      .post(`/homeworks/${homeworkId}/submissions`)
      .set(auth(studentToken))
      .field('fileTitle', 'answer.txt')
      .attach('file', Buffer.from('answer'), 'answer.txt')
      .expect(201);

    const submission = await prisma.homeworkSubmission.findFirst({ where: { homeworkId } });
    expect(submission?.fileResourceId).toBeTruthy();

    await request(server)
      .get(`/files/${submission.fileResourceId}/download`)
      .set(auth(teacherToken))
      .expect(200);

    const foreignUser = await prisma.user.create({
      data: {
        email: 'foreign-student@mail.ru',
        role: ROLE.STUDENT,
        displayName: 'Foreign Student',
        passwordHash: await bcrypt.hash('foreignpass', 4),
        studentProfile: {
          create: {
            teacherId,
            name: 'Foreign Student',
            access: ACCESS_STATUS.ACTIVE,
            settings: {},
          },
        },
      },
      include: { studentProfile: true },
    });
    await ensureLegacyStudent(prisma, foreignUser.studentProfile.id);
    const foreignFile = await prisma.fileResource.create({
      data: {
        ownerId: foreignUser.id,
        originalName: 'foreign.txt',
        mimeType: 'text/plain',
        size: 7,
        url: 'http://127.0.0.1:3000/files/foreign/download',
        storagePath: path.join(uploadDir, 'foreign.txt'),
      },
    });
    fs.writeFileSync(path.join(uploadDir, 'foreign.txt'), 'foreign');

    const firstStudentPage = await request(server)
      .get('/students?page=1&pageSize=1')
      .set(auth(teacherToken))
      .expect(200);
    const secondStudentPage = await request(server)
      .get('/students?page=2&pageSize=1')
      .set(auth(teacherToken))
      .expect(200);
    expect(firstStudentPage.body.total).toBe(2);
    expect(firstStudentPage.body.items).toHaveLength(1);
    expect(secondStudentPage.body.items).toHaveLength(1);
    expect(firstStudentPage.body.items[0].id).not.toBe(secondStudentPage.body.items[0].id);

    const laterStart = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const laterEnd = new Date(Date.now() + 4 * 60 * 60 * 1000);
    await request(server)
      .post('/lessons')
      .set(auth(teacherToken))
      .send({ studentId, topic: 'Later lesson', startAt: laterStart.toISOString(), endAt: laterEnd.toISOString() })
      .expect(201);
    await request(server)
      .post('/lessons')
      .set(auth(teacherToken))
      .send({ studentId: foreignUser.studentProfile.id, topic: 'Teacher conflict', startAt: laterStart.toISOString(), endAt: laterEnd.toISOString() })
      .expect(409);

    await request(server)
      .get(`/files/${foreignFile.id}/download`)
      .set(auth(studentToken))
      .expect(403);

    const otherTeacherUser = await prisma.user.create({
      data: {
        email: 'other-teacher@mail.ru',
        role: ROLE.TEACHER,
        displayName: 'Other Teacher',
        passwordHash: await bcrypt.hash('otherpass', 4),
        teacherProfile: {
          create: {
            name: 'Other Teacher',
            settings: {},
          },
        },
      },
      include: { teacherProfile: true },
    });
    await ensureLegacyTeacher(prisma, otherTeacherUser.teacherProfile.id);
    const otherStudentUser = await prisma.user.create({
      data: {
        email: 'other-student@mail.ru',
        role: ROLE.STUDENT,
        displayName: 'Other Student',
        passwordHash: await bcrypt.hash('otherstudentpass', 4),
        studentProfile: {
          create: {
            teacherId: otherTeacherUser.teacherProfile.id,
            name: 'Other Student',
            access: ACCESS_STATUS.ACTIVE,
            settings: {},
          },
        },
      },
      include: { studentProfile: true },
    });
    await ensureLegacyStudent(prisma, otherStudentUser.studentProfile.id);
    const otherTeacherLogin = await request(server)
      .post('/auth/login')
      .send({ email: 'other-teacher@mail.ru', password: 'otherpass' })
      .expect(201);
    const otherTeacherToken = otherTeacherLogin.body.session.token;
    await request(server).get(`/students/${studentId}`).set(auth(otherTeacherToken)).expect(404);
    await request(server)
      .get('/students?page=1&pageSize=10')
      .set(auth(otherTeacherToken))
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(1));
    const otherFilePath = path.join(uploadDir, 'other-private.txt');
    fs.writeFileSync(otherFilePath, 'other');
    const otherFile = await prisma.fileResource.create({
      data: {
        ownerId: otherStudentUser.id,
        originalName: 'other-private.txt',
        mimeType: 'text/plain',
        size: 5,
        url: 'http://127.0.0.1:3000/files/other-private/download',
        storagePath: otherFilePath,
      },
    });

    await request(server)
      .get(`/files/${otherFile.id}/download`)
      .set(auth(teacherToken))
      .expect(403);

    await request(server)
      .post(`/homeworks/${homeworkId}/review`)
      .set(auth(teacherToken))
      .send({ status: 'reviewed', comment: 'Accepted' })
      .expect(201);

    await request(server)
      .post(`/homeworks/${homeworkId}/submissions`)
      .set(auth(studentToken))
      .field('fileTitle', 'answer-again.txt')
      .attach('file', Buffer.from('answer again'), 'answer-again.txt')
      .expect(409);

    const resetRequest = await request(server)
      .post('/auth/password-reset')
      .send({ email: 'teacher-e2e@mail.ru' })
      .expect(201);
    const resetToken = resetRequest.body.reset.token;
    expect(resetToken).toBeTruthy();

    await request(server)
      .post('/auth/access-token/complete')
      .send({ token: resetToken, password: 'teacherpass2' })
      .expect(201);

    await request(server).get('/bootstrap').set(auth(teacherToken)).expect(401);

    await request(server)
      .post('/auth/access-token/complete')
      .send({ token: resetToken, password: 'teacherpass3' })
      .expect(409);

    const teacherRelogin = await request(server)
      .post('/auth/login')
      .send({ email: 'teacher-e2e@mail.ru', password: 'teacherpass2' })
      .expect(201);
    const refreshedTeacherToken = teacherRelogin.body.session.token;
    await request(server).get('/bootstrap').set(auth(refreshedTeacherToken)).expect(200);
    await request(server).post('/auth/logout').set(auth(refreshedTeacherToken)).expect(201);
    await request(server).get('/bootstrap').set(auth(refreshedTeacherToken)).expect(401);

    await prisma.studentProfile.update({ where: { id: studentId }, data: { access: ACCESS_STATUS.DISABLED } });
    await request(server)
      .post('/auth/password-reset')
      .send({ email: 'student-e2e@mail.ru' })
      .expect(201)
      .expect(({ body }) => expect(body).toEqual({ ok: true }));

    await request(server)
      .post('/auth/password-reset')
      .send({ email: 'unknown-e2e@mail.ru' })
      .expect(201)
      .expect(({ body }) => expect(body).toEqual({ ok: true }));
  });

  it('rate limits login, password reset and token verification by target', async () => {
    const login = () => request(server)
      .post('/auth/login')
      .send({ email: 'limited-e2e@mail.ru', password: 'wrongpass' });
    for (let attempt = 0; attempt < 8; attempt += 1) await login().expect(401);
    await login().expect(429).expect(({ body }) => expect(body.code).toBe('rate_limited'));

    const reset = () => request(server)
      .post('/auth/password-reset')
      .send({ email: 'limited-reset-e2e@mail.ru' });
    for (let attempt = 0; attempt < 3; attempt += 1) await reset().expect(201);
    await reset().expect(429);

    const verify = () => request(server)
      .post('/auth/access-token/verify')
      .send({ token: 'limited-invalid-token' });
    for (let attempt = 0; attempt < 10; attempt += 1) await verify().expect(422);
    await verify().expect(429);
  });

  it('runs workspace admin, invitation, multi-role and isolation flows on PostgreSQL', async () => {
    const admin = await prisma.user.create({ data: {
      email: 'workspace-admin-e2e@mail.ru', displayName: 'Workspace Admin', role: null,
      passwordHash: await bcrypt.hash('adminpass123', 4),
    } });
    const workspace = await prisma.workspace.create({ data: { name: 'Workspace A', slug: 'workspace-a-e2e', timezone: 'UTC' } });
    const other = await prisma.workspace.create({ data: { name: 'Workspace B', slug: 'workspace-b-e2e', timezone: 'UTC' } });
    const member = await prisma.workspaceMembership.create({ data: {
      workspaceId: workspace.id, userId: admin.id, roles: { create: [{ role: 'admin' }] },
    } });
    const adminLogin = await request(server).post('/api/v2/auth/login')
      .send({ email: admin.email, password: 'adminpass123' }).expect(200);
    const token = adminLogin.body.session.token;
    expect(adminLogin.body.contexts).toEqual(expect.arrayContaining([expect.objectContaining({ workspaceId: workspace.id, roles: ['admin'] })]));
    await request(server).post('/auth/login').send({ email: admin.email, password: 'adminpass123' }).expect(401);
    await request(server).get('/api/v2/me').set(auth(token)).expect(200);
    await request(server).get(`/api/v2/workspaces/${workspace.id}/members`).set(auth(token)).expect(400);
    await request(server).get(`/api/v2/workspaces/${other.id}/members`).set(auth(token)).set('X-Active-Role', 'admin').expect(404);
    await request(server).get(`/api/v2/workspaces/${workspace.id}/members`).set(auth(token)).set('X-Active-Role', 'student').expect(403);
    await request(server).get(`/api/v2/workspaces/${workspace.id}/members`).set(auth(token)).set('X-Active-Role', 'admin').expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(1));

    let link = '';
    const mailer = app.get(AuthMailerService);
    const send = vi.spyOn(mailer, 'sendWorkspaceInvitation').mockImplementation(async input => {
      link = input.link;
      return { status: 'sent', provider: 'smtp' };
    });
    const invite = await request(server).post(`/api/v2/workspaces/${workspace.id}/invitations`)
      .set(auth(token)).set('X-Active-Role', 'admin').set('Idempotency-Key', 'invite-e2e-one')
      .send({ email: 'new-workspace-student@mail.ru', roles: ['student', 'teacher'] }).expect(200);
    expect(invite.body.item).not.toHaveProperty('token');
    expect(link).toContain('token=');
    const inviteToken = new URL(link).searchParams.get('token');
    const sameInvite = await request(server).post(`/api/v2/workspaces/${workspace.id}/invitations`)
      .set(auth(token)).set('X-Active-Role', 'admin').set('Idempotency-Key', 'invite-e2e-one')
      .send({ email: 'new-workspace-student@mail.ru', roles: ['student', 'teacher'] }).expect(200);
    expect(sameInvite.body.item.id).toBe(invite.body.item.id);
    await request(server).post(`/api/v2/workspaces/${workspace.id}/invitations`)
      .set(auth(token)).set('X-Active-Role', 'admin').set('Idempotency-Key', 'invite-e2e-one')
      .send({ email: 'different@mail.ru', roles: ['student'] }).expect(409);

    const accepted = await request(server).post('/api/v2/invitations/accept-new')
      .send({ token: inviteToken, displayName: 'New Learner', password: 'learnerpass123' }).expect(200);
    expect(accepted.body.contexts[0].roles).toEqual(expect.arrayContaining(['student', 'teacher']));
    await request(server).post('/api/v2/invitations/accept-new')
      .send({ token: inviteToken, displayName: 'New Learner', password: 'learnerpass123' }).expect(409);
    const learnerToken = accepted.body.session.token;
    await request(server).get(`/api/v2/workspaces/${workspace.id}/members`)
      .set(auth(learnerToken)).set('X-Active-Role', 'teacher').expect(403);
    const learnerMember = await prisma.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: accepted.body.user.id } } });
    const suspended = await request(server).post(`/api/v2/workspaces/${workspace.id}/members/${learnerMember.id}/suspend`)
      .set(auth(token)).set('X-Active-Role', 'admin').set('If-Match', String(learnerMember.revision))
      .send({ reason: 'Временная блокировка для проверки' }).expect(200);
    await request(server).get(`/api/v2/workspaces/${workspace.id}`).set(auth(learnerToken)).set('X-Active-Role', 'student').expect(403);
    await request(server).post(`/api/v2/workspaces/${workspace.id}/members/${member.id}/suspend`)
      .set(auth(token)).set('X-Active-Role', 'admin').set('If-Match', String(member.revision))
      .send({ reason: 'Проверка последнего администратора' }).expect(409);
    await request(server).post(`/api/v2/workspaces/${workspace.id}/members/${learnerMember.id}/resume`)
      .set(auth(token)).set('X-Active-Role', 'admin').set('If-Match', String(suspended.body.item.revision))
      .send({ reason: 'Восстановление после проверки' }).expect(200);
    const audit = await request(server).get(`/api/v2/workspaces/${workspace.id}/audit-events`)
      .set(auth(token)).set('X-Active-Role', 'admin').expect(200);
    expect(audit.body.items.some((item: any) => item.action === 'member.suspended')).toBe(true);
    send.mockRestore();
  });

  it('isolates two workspaces and handles revisions, existing accounts, token rotation and mail retry', async () => {
    const passwordHash = await bcrypt.hash('workspace-pass-123', 4);
    const [adminA, adminB, shared] = await Promise.all([
      prisma.user.create({ data: { email: 'admin-a-e2e@mail.ru', displayName: 'Admin A', role: null, passwordHash } }),
      prisma.user.create({ data: { email: 'admin-b-e2e@mail.ru', displayName: 'Admin B', role: null, passwordHash } }),
      prisma.user.create({ data: { email: 'shared-e2e@mail.ru', displayName: 'Shared User', role: null, passwordHash } }),
    ]);
    const [a, b] = await Promise.all([
      prisma.workspace.create({ data: { name: 'Isolated A', slug: 'isolated-a-e2e', timezone: 'UTC' } }),
      prisma.workspace.create({ data: { name: 'Isolated B', slug: 'isolated-b-e2e', timezone: 'UTC' } }),
    ]);
    const [ownerA, ownerB, sharedA, sharedB] = await Promise.all([
      prisma.workspaceMembership.create({ data: { workspaceId: a.id, userId: adminA.id, roles: { create: [{ role: 'admin' }] } } }),
      prisma.workspaceMembership.create({ data: { workspaceId: b.id, userId: adminB.id, roles: { create: [{ role: 'admin' }] } } }),
      prisma.workspaceMembership.create({ data: { workspaceId: a.id, userId: shared.id, roles: { create: [{ role: 'student' }] } } }),
      prisma.workspaceMembership.create({ data: { workspaceId: b.id, userId: shared.id, roles: { create: [{ role: 'teacher' }] } } }),
    ]);
    const login = async (email: string) => (await request(server).post('/api/v2/auth/login').send({ email, password: 'workspace-pass-123' }).expect(200)).body.session.token;
    const [tokenA, tokenB, sharedToken] = await Promise.all([login(adminA.email), login(adminB.email), login(shared.email)]);
    const headersA = { ...auth(tokenA), 'X-Active-Role': 'admin' };
    const headersB = { ...auth(tokenB), 'X-Active-Role': 'admin' };

    const contexts = await request(server).get('/api/v2/me/workspaces').set(auth(sharedToken)).expect(200);
    expect(contexts.body.items.map((item: { workspaceId: string }) => item.workspaceId)).toEqual(expect.arrayContaining([a.id, b.id]));
    await request(server).get(`/api/v2/workspaces/${b.id}`).set(auth(sharedToken)).set('X-Active-Role', 'teacher').expect(200);
    await request(server).get(`/api/v2/workspaces/${b.id}/members`).set(auth(sharedToken)).set('X-Active-Role', 'teacher').expect(403);
    await request(server).get(`/api/v2/workspaces/${b.id}/members`).set(headersA).expect(404);
    const firstPage = await request(server).get(`/api/v2/workspaces/${a.id}/members?limit=1`).set(headersA).expect(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.pageInfo.hasMore).toBe(true);
    const secondPage = await request(server).get(`/api/v2/workspaces/${a.id}/members?limit=1&cursor=${encodeURIComponent(firstPage.body.pageInfo.nextCursor)}`).set(headersA).expect(200);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);
    await request(server).get(`/api/v2/workspaces/${a.id}/members?limit=1&role=student&cursor=${encodeURIComponent(firstPage.body.pageInfo.nextCursor)}`).set(headersA).expect(400);
    await request(server).get(`/api/v2/workspaces/${a.id}/members?q=Shared&role=student`).set(headersA).expect(200)
      .expect(({ body }) => expect(body.items.map((item: { id: string }) => item.id)).toEqual([sharedA.id]));
    await request(server).get(`/api/v2/workspaces/${a.id}/members/${ownerB.id}`).set(headersA).expect(404);
    await request(server).patch(`/api/v2/workspaces/${a.id}/members/${ownerB.id}`).set(headersA).set('If-Match', '0').send({ displayNameOverride: 'No' }).expect(404);
    await request(server).get(`/api/v2/workspaces/${a.id}/audit-events`).set(headersB).expect(404);

    const memberUrl = `/api/v2/workspaces/${a.id}/members/${sharedA.id}`;
    await request(server).patch(memberUrl).set(headersA).send({ displayNameOverride: 'A Local Name' }).expect(428);
    await request(server).patch(memberUrl).set(headersA).set('If-Match', '4').send({ displayNameOverride: 'A Local Name' }).expect(412);
    await request(server).patch(memberUrl).set(headersA).set('If-Match', '0').send({ displayNameOverride: '   ' }).expect(400);
    const renamed = await request(server).patch(memberUrl).set(headersA).set('If-Match', '0')
      .set('x-request-id', 'rename-e2e-request').send({ displayNameOverride: 'A Local Name' }).expect(200);
    expect(renamed.body.item.displayName).toBe('A Local Name');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: shared.id } })).displayName).toBe('Shared User');
    await request(server).get(`/api/v2/workspaces/${b.id}/members/${sharedB.id}`).set(headersB).expect(200)
      .expect(({ body }) => expect(body.item.displayName).toBe('Shared User'));
    await request(server).post(`${memberUrl}/suspend`).set(headersA).set('If-Match', '1')
      .send({ reason: 'Testing scoped suspension' }).expect(200);
    await request(server).get(`/api/v2/workspaces/${a.id}`).set(auth(sharedToken)).set('X-Active-Role', 'student').expect(403);
    await request(server).get(`/api/v2/workspaces/${b.id}`).set(auth(sharedToken)).set('X-Active-Role', 'teacher').expect(200);
    await request(server).post(`${memberUrl}/resume`).set(headersA).set('If-Match', '2')
      .send({ reason: 'Testing scoped resumption' }).expect(200);
    const audit = await request(server).get(`/api/v2/workspaces/${a.id}/audit-events`).set(headersA).expect(200);
    expect(audit.body.items.find((item: { action: string }) => item.action === 'member.name.updated').requestId).toBe('rename-e2e-request');
    const auditFirst = await request(server).get(`/api/v2/workspaces/${a.id}/audit-events?limit=1`).set(headersA).expect(200);
    const auditSecond = await request(server).get(`/api/v2/workspaces/${a.id}/audit-events?limit=1&cursor=${encodeURIComponent(auditFirst.body.pageInfo.nextCursor)}`).set(headersA).expect(200);
    expect(auditSecond.body.items[0].id).not.toBe(auditFirst.body.items[0].id);
    const rolePath = `${memberUrl}/roles`;
    const grant = await request(server).post(rolePath).set(headersA).set('Idempotency-Key', 'grant-e2e')
      .send({ role: 'teacher', reason: 'Adding another teaching role' }).expect(200);
    const repeatGrant = await request(server).post(rolePath).set(headersA).set('Idempotency-Key', 'grant-e2e')
      .send({ role: 'teacher', reason: 'Adding another teaching role' }).expect(200);
    expect(repeatGrant.body.item.revision).toBe(grant.body.item.revision);
    expect(await prisma.workspaceRoleGrant.count({ where: { membershipId: sharedA.id, role: 'teacher' } })).toBe(1);
    await request(server).post(rolePath).set(headersA).set('Idempotency-Key', 'grant-e2e')
      .send({ role: 'admin', reason: 'Different body for the same key' }).expect(409);
    await request(server).post(`${rolePath}/teacher/revoke`).set(headersA).set('If-Match', '0')
      .send({ reason: 'Stale revision cannot revoke' }).expect(412);
    await request(server).post(`${rolePath}/teacher/revoke`).set(headersA).set('If-Match', String(grant.body.item.revision))
      .send({ reason: 'Revoking temporary teaching role' }).expect(200);

    const mailer = app.get(AuthMailerService);
    let sentLink = '';
    const send = vi.spyOn(mailer, 'sendWorkspaceInvitation').mockImplementation(async input => {
      sentLink = input.link;
      return { status: 'sent', provider: 'smtp' };
    });
    const invitePathB = `/api/v2/workspaces/${b.id}/invitations`;
    const invitePathA = `/api/v2/workspaces/${a.id}/invitations`;
    const existing = await request(server).post(invitePathB).set(headersB).set('Idempotency-Key', 'existing-e2e')
      .send({ email: adminA.email, roles: ['student'] }).expect(200);
    const existingToken = new URL(sentLink).searchParams.get('token');
    await request(server).post('/api/v2/invitations/accept-existing').set(auth(sharedToken)).send({ token: existingToken }).expect(403);
    await request(server).post('/api/v2/invitations/accept-existing').set(auth(tokenA)).send({ token: existingToken }).expect(200);
    await request(server).post('/api/v2/invitations/accept-existing').set(auth(tokenA)).send({ token: existingToken }).expect(409);
    expect(await prisma.workspaceMembership.count({ where: { workspaceId: b.id, userId: adminA.id } })).toBe(1);
    expect((await prisma.user.findMany({ where: { email: adminA.email } })).length).toBe(1);
    await request(server).post(`${invitePathA}/${existing.body.item.id}/revoke`).set(headersA)
      .set('If-Match', String(existing.body.item.revision)).send({}).expect(404);

    const rotating = await request(server).post(invitePathA).set(headersA).set('Idempotency-Key', 'rotating-e2e')
      .send({ email: 'rotating-e2e@mail.ru', roles: ['student'] }).expect(200);
    const oldToken = new URL(sentLink).searchParams.get('token');
    const resent = await request(server).post(`${invitePathA}/${rotating.body.item.id}/resend`).set(headersA)
      .set('If-Match', String(rotating.body.item.revision)).send({}).expect(200);
    const newToken = new URL(sentLink).searchParams.get('token');
    expect(newToken).not.toBe(oldToken);
    await request(server).post('/api/v2/invitations/accept-new').send({ token: oldToken, displayName: 'Old Link', password: 'long-password' }).expect(409);
    await request(server).post(`${invitePathA}/${rotating.body.item.id}/revoke`).set(headersA)
      .set('If-Match', String(resent.body.item.revision)).send({ reason: 'Testing invitation revocation' }).expect(200);
    await request(server).post('/api/v2/invitations/accept-new').send({ token: newToken, displayName: 'New Link', password: 'long-password' }).expect(409);

    send.mockRejectedValueOnce(new Error('SMTP unavailable'));
    const failed = await request(server).post(invitePathA).set(headersA).set('Idempotency-Key', 'failed-mail-e2e')
      .send({ email: 'mail-failure-e2e@mail.ru', roles: ['student'] }).expect(200);
    expect((await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: failed.body.item.id } })).deliveryStatus).toBe('failed');
    const outbox = await prisma.workspaceEmailOutbox.findFirstOrThrow({ where: { invitationId: failed.body.item.id } });
    await prisma.workspaceEmailOutbox.update({ where: { id: outbox.id }, data: { nextAttemptAt: new Date(0) } });
    await app.get((await import('../../src/workspace/workspace-invitations.service')).WorkspaceInvitationsService).flushPending();
    expect((await prisma.workspaceEmailOutbox.findUniqueOrThrow({ where: { id: outbox.id } })).encryptedLink).toBeNull();
    expect((await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: failed.body.item.id } })).deliveryStatus).toBe('sent');

    let expiredLink = '';
    send.mockImplementationOnce(async input => { expiredLink = input.link; throw new Error('SMTP unavailable'); });
    const expiring = await request(server).post(invitePathA).set(headersA).set('Idempotency-Key', 'expiring-e2e')
      .send({ email: 'expired-e2e@mail.ru', roles: ['student'] }).expect(200);
    await prisma.workspaceInvitation.update({ where: { id: expiring.body.item.id }, data: { expiresAt: new Date(0) } });
    await app.get((await import('../../src/workspace/workspace-invitations.service')).WorkspaceInvitationsService).flushPending();
    expect((await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: expiring.body.item.id } })).status).toBe('expired');
    expect((await prisma.workspaceEmailOutbox.findFirstOrThrow({ where: { invitationId: expiring.body.item.id } })).encryptedLink).toBeNull();
    await request(server).post('/api/v2/invitations/accept-new').send({ token: new URL(expiredLink).searchParams.get('token'), displayName: 'Expired Link', password: 'long-password' }).expect(409);
    send.mockRestore();

    const secondAdmin = await prisma.workspaceMembership.create({ data: { workspaceId: a.id, userId: adminB.id, roles: { create: [{ role: 'admin' }] } } });
    const compete = await Promise.all([
      request(server).post(`/api/v2/workspaces/${a.id}/members/${ownerA.id}/suspend`).set(headersA).set('If-Match', '0').send({ reason: 'Concurrent self suspension' }),
      request(server).post(`/api/v2/workspaces/${a.id}/members/${secondAdmin.id}/suspend`).set(headersB).set('If-Match', '0').send({ reason: 'Concurrent self suspension' }),
    ]);
    expect(compete.filter(result => result.status === 200)).toHaveLength(1);
    expect(compete.filter(result => result.status === 409)).toHaveLength(1);
    expect(await prisma.workspaceMembership.count({ where: { workspaceId: a.id, status: 'active', roles: { some: { role: 'admin', revokedAt: null } } } })).toBe(1);
    expect(ownerA.id).not.toBe(ownerB.id);
  });

  it('closes a suspended legacy cabinet without affecting another workspace', async () => {
    const teacher = await prisma.user.create({ data: {
      email: 'legacy-isolation-e2e@mail.ru', displayName: 'Legacy Isolation', role: ROLE.TEACHER,
      passwordHash: await bcrypt.hash('teacherpass', 4),
      teacherProfile: { create: { name: 'Legacy Isolation', settings: {} } },
    }, include: { teacherProfile: true } });
    await ensureLegacyTeacher(prisma, teacher.teacherProfile.id);
    const mapping = await prisma.legacyWorkspaceMapping.findUniqueOrThrow({ where: { teacherProfileId: teacher.teacherProfile.id } });
    const oldMember = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: mapping.workspaceId, userId: teacher.id } },
    });
    const otherAdmin = await prisma.user.create({ data: {
      email: 'legacy-backup-admin-e2e@mail.ru', displayName: 'Backup Admin', role: null,
      passwordHash: await bcrypt.hash('backup-pass-123', 4),
    } });
    await prisma.workspaceMembership.create({ data: {
      workspaceId: mapping.workspaceId, userId: otherAdmin.id, roles: { create: [{ role: 'admin' }] },
    } });
    const independent = await prisma.workspace.create({ data: { name: 'Independent', slug: 'independent-e2e', timezone: 'UTC' } });
    await prisma.workspaceMembership.create({ data: {
      workspaceId: independent.id, userId: teacher.id, roles: { create: [{ role: 'student' }] },
    } });
    const oldLogin = await request(server).post('/auth/login')
      .send({ email: teacher.email, password: 'teacherpass' }).expect(201);
    const accountLogin = await request(server).post('/api/v2/auth/login')
      .send({ email: teacher.email, password: 'teacherpass' }).expect(200);
    expect(accountLogin.body.contexts).toEqual(expect.arrayContaining([
      expect.objectContaining({ workspaceId: mapping.workspaceId, legacyRole: 'teacher' }),
      expect.objectContaining({ workspaceId: independent.id, legacyRole: null }),
    ]));
    const adminLogin = await request(server).post('/api/v2/auth/login')
      .send({ email: otherAdmin.email, password: 'backup-pass-123' }).expect(200);
    await request(server).post(`/api/v2/workspaces/${mapping.workspaceId}/members/${oldMember.id}/suspend`)
      .set(auth(adminLogin.body.session.token)).set('X-Active-Role', 'admin').set('If-Match', String(oldMember.revision))
      .send({ reason: 'Legacy access test' }).expect(200);
    await request(server).get('/bootstrap').set(auth(oldLogin.body.token)).expect(401);
    await request(server).post('/auth/login')
      .send({ email: teacher.email, password: 'teacherpass' }).expect(401);
    await request(server).get(`/api/v2/workspaces/${independent.id}`)
      .set(auth(accountLogin.body.session.token)).set('X-Active-Role', 'student').expect(200);
  });

  it('rate limits repeated workspace invitations for one target email', async () => {
    const admin = await prisma.user.create({ data: {
      email: 'rate-admin-e2e@mail.ru', displayName: 'Rate Admin', role: null,
      passwordHash: await bcrypt.hash('rate-pass-123', 4),
    } });
    const workspace = await prisma.workspace.create({ data: { name: 'Rate Limited', slug: 'rate-limited-e2e', timezone: 'UTC' } });
    await prisma.workspaceMembership.create({ data: {
      workspaceId: workspace.id, userId: admin.id, roles: { create: [{ role: 'admin' }] },
    } });
    const login = await request(server).post('/api/v2/auth/login')
      .send({ email: admin.email, password: 'rate-pass-123' }).expect(200);
    const path = `/api/v2/workspaces/${workspace.id}/invitations`;
    const send = () => request(server).post(path).set(auth(login.body.session.token))
      .set('X-Active-Role', 'admin').set('Idempotency-Key', 'rate-limit-e2e')
      .send({ email: 'rate-target-e2e@mail.ru', roles: ['student'] });
    for (let attempt = 0; attempt < 5; attempt += 1) await send().expect(200);
    await send().expect(429).expect(({ body }) => expect(body.code).toBe('rate_limited'));
  });

  it('exports protected aggregate operational metrics', async () => {
    await request(server).get('/internal/metrics').expect(404);
    await request(server).get('/internal/metrics').set('Authorization', 'Bearer wrong-token').expect(404);
    const metrics = () => request(server).get('/internal/metrics').set('Authorization', `Bearer ${process.env.METRICS_TOKEN}`);
    const before = await metrics().expect(200);
    expect(before.headers['content-type']).toContain('text/plain');
    const counter = (body: string, name: string) => Number(body.match(new RegExp(`^${name} (\\d+)$`, 'm'))?.[1]);
    const loginBefore = counter(before.text, 'oge_login_failures_total');
    const accessBefore = counter(before.text, 'oge_access_denials_total');
    await request(server).post('/api/v2/auth/login').send({ email: 'absent-e2e@mail.ru', password: 'wrong-password' }).expect(401);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'shared-e2e@mail.ru' } });
    const member = await prisma.workspaceMembership.findFirstOrThrow({ where: { userId: user.id, roles: { some: { role: 'student' } } } });
    const token = (await request(server).post('/api/v2/auth/login').send({ email: user.email, password: 'workspace-pass-123' }).expect(200)).body.session.token;
    await request(server).get(`/api/v2/workspaces/${member.workspaceId}/members`)
      .set(auth(token)).set('X-Active-Role', 'student').expect(403);
    const after = await metrics().expect(200);
    expect(counter(after.text, 'oge_login_failures_total')).toBe(loginBefore + 1);
    expect(counter(after.text, 'oge_access_denials_total')).toBe(accessBefore + 1);
    expect(after.text).toMatch(/^oge_invitation_delivery_failures_total \d+$/m);
    expect(after.text).toMatch(/^oge_invitation_outbox_queued \d+$/m);
    expect(after.text).toMatch(/^oge_invitation_outbox_failed \d+$/m);
    expect(after.text).not.toContain('mail.ru');
    expect(after.text).not.toContain('token=');
  });

  it('isolates every workspace admin route and recovers concurrent invitations', async () => {
    const passwordHash = await bcrypt.hash('boundary-pass-123', 4);
    const [adminA, adminB, existing] = await Promise.all([
      prisma.user.create({ data: { email: 'boundary-a-e2e@mail.ru', displayName: 'Boundary A', passwordHash } }),
      prisma.user.create({ data: { email: 'boundary-b-e2e@mail.ru', displayName: 'Boundary B', passwordHash } }),
      prisma.user.create({ data: { email: 'boundary-existing-e2e@mail.ru', displayName: 'Existing Member', passwordHash } }),
    ]);
    const [a, b] = await Promise.all([
      prisma.workspace.create({ data: { name: 'Boundary A', slug: 'boundary-a-e2e' } }),
      prisma.workspace.create({ data: { name: 'Boundary B', slug: 'boundary-b-e2e' } }),
    ]);
    await Promise.all([
      prisma.workspaceMembership.create({ data: { workspaceId: a.id, userId: adminA.id, roles: { create: [{ role: 'admin' }] } } }),
      prisma.workspaceMembership.create({ data: { workspaceId: b.id, userId: adminB.id, roles: { create: [{ role: 'admin' }] } } }),
    ]);
    const existingMember = await prisma.workspaceMembership.create({ data: {
      workspaceId: a.id, userId: existing.id, roles: { create: [{ role: 'student' }] },
    } });
    const foreignMember = await prisma.workspaceMembership.create({ data: {
      workspaceId: b.id, userId: existing.id, roles: { create: [{ role: 'student' }] },
    } });
    const login = async (email: string) => (await request(server).post('/api/v2/auth/login')
      .send({ email, password: 'boundary-pass-123' }).expect(200)).body.session.token;
    const [tokenA, tokenB, existingToken] = await Promise.all([login(adminA.email), login(adminB.email), login(existing.email)]);
    const headersA = { ...auth(tokenA), 'X-Active-Role': 'admin' };
    const headersB = { ...auth(tokenB), 'X-Active-Role': 'admin' };
    const prefixA = `/api/v2/workspaces/${a.id}`;
    const prefixB = `/api/v2/workspaces/${b.id}`;
    for (const suffix of ['', '/members', '/invitations', '/audit-events']) {
      await request(server).get(`${prefixB}${suffix}`).set(headersA).expect(404);
    }
    await request(server).get(`${prefixA}/members/${foreignMember.id}`).set(headersA).expect(404);
    await request(server).patch(`${prefixA}/members/${foreignMember.id}`).set(headersA).set('If-Match', '0')
      .send({ displayNameOverride: 'Foreign Name' }).expect(404);
    await request(server).post(`${prefixA}/members/${foreignMember.id}/roles`).set(headersA).set('Idempotency-Key', 'foreign-grant')
      .send({ role: 'teacher' }).expect(404);
    for (const suffix of ['/roles/student/revoke', '/suspend', '/resume']) {
      await request(server).post(`${prefixA}/members/${foreignMember.id}${suffix}`).set(headersA).set('If-Match', '0')
        .send({ reason: 'Foreign member access attempt' }).expect(404);
    }

    const mailer = app.get(AuthMailerService);
    const invitationService = app.get(WorkspaceInvitationsService);
    let delivered = '';
    const send = vi.spyOn(mailer, 'sendWorkspaceInvitation').mockImplementation(async input => {
      delivered = input.link;
      return { status: 'sent', provider: 'smtp' };
    });
    const invite = (workspaceId: string, key: string, email: string, roles: string[]) => request(server)
      .post(`/api/v2/workspaces/${workspaceId}/invitations`).set(workspaceId === a.id ? headersA : headersB)
      .set('Idempotency-Key', key).send({ email, roles });
    const foreignInvite = await invite(b.id, 'foreign-invite', 'foreign-invite-e2e@mail.ru', ['student']).expect(200);
    for (const suffix of ['/resend', '/revoke']) {
      await request(server).post(`${prefixA}/invitations/${foreignInvite.body.item.id}${suffix}`).set(headersA)
        .set('If-Match', '0').send({}).expect(404);
    }

    const activeInvite = await invite(a.id, 'active-existing', existing.email, ['teacher']).expect(200);
    const activeToken = new URL(delivered).searchParams.get('token');
    const [first, second] = await Promise.all([
      request(server).post('/api/v2/invitations/accept-existing').set(auth(existingToken)).send({ token: activeToken }),
      request(server).post('/api/v2/invitations/accept-existing').set(auth(existingToken)).send({ token: activeToken }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(await prisma.workspaceMembership.count({ where: { workspaceId: a.id, userId: existing.id } })).toBe(1);
    expect(await prisma.workspaceRoleGrant.count({ where: { membershipId: existingMember.id, role: 'teacher' } })).toBe(1);
    expect((await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: activeInvite.body.item.id } })).status).toBe('accepted');

    await prisma.workspaceMembership.update({ where: { id: foreignMember.id }, data: { status: 'suspended' } });
    const suspendedInvite = await invite(b.id, 'suspended-existing', existing.email, ['teacher']).expect(200);
    const suspendedToken = new URL(delivered).searchParams.get('token');
    await request(server).post('/api/v2/invitations/accept-existing').set(auth(existingToken))
      .send({ token: suspendedToken }).expect(409);
    expect((await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: foreignMember.id } })).status).toBe('suspended');
    expect((await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: suspendedInvite.body.item.id } })).status).toBe('pending');

    const newInvite = await invite(a.id, 'new-concurrent', 'boundary-new-e2e@mail.ru', ['student']).expect(200);
    const newToken = new URL(delivered).searchParams.get('token');
    const accepted = await Promise.all([
      request(server).post('/api/v2/invitations/accept-new').send({ token: newToken, displayName: 'New Member', password: 'new-member-pass' }),
      request(server).post('/api/v2/invitations/accept-new').send({ token: newToken, displayName: 'New Member', password: 'new-member-pass' }),
    ]);
    expect(accepted.map(result => result.status).sort()).toEqual([200, 409]);
    expect(await prisma.user.count({ where: { email: 'boundary-new-e2e@mail.ru' } })).toBe(1);
    expect((await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: newInvite.body.item.id } })).status).toBe('accepted');

    const pausedDelivery = vi.spyOn(invitationService, 'deliverOne').mockResolvedValue(undefined);
    const pending = await invite(a.id, 'after-commit', 'after-commit-e2e@mail.ru', ['student']).expect(200);
    pausedDelivery.mockRestore();
    const outbox = await prisma.workspaceEmailOutbox.findFirstOrThrow({ where: { invitationId: pending.body.item.id } });
    expect(outbox.sentAt).toBeNull();
    expect(outbox.encryptedLink).toBeTruthy();
    await invitationService.flushPending();
    expect((await prisma.workspaceEmailOutbox.findUniqueOrThrow({ where: { id: outbox.id } })).encryptedLink).toBeNull();
    expect((await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: pending.body.item.id } })).deliveryStatus).toBe('sent');
    expect(delivered).toContain('token=');

    await request(server).post(`${prefixA}/invitations`).set(headersA).set('Idempotency-Key', 'invalid-extra')
      .send({ email: 'extra-e2e@mail.ru', roles: ['student'], isAdmin: true }).expect(400);
    await request(server).patch(`${prefixA}/members/${existingMember.id}`).set(headersA).set('If-Match', '1')
      .send({ displayNameOverride: 'Safe Name', email: 'hijack@mail.ru' }).expect(400);
    send.mockRestore();
  });

  it('manages isolated multi-exam catalogs with immutable published versions', async () => {
    const passwordHash = await bcrypt.hash('catalog-pass-123', 4);
    const [adminA, adminB, globalEditor] = await Promise.all([
      prisma.user.create({ data: { email: 'catalog-a-e2e@mail.ru', displayName: 'Catalog Admin A', passwordHash } }),
      prisma.user.create({ data: { email: 'catalog-b-e2e@mail.ru', displayName: 'Catalog Admin B', passwordHash } }),
      prisma.user.create({ data: { email: 'catalog-global-e2e@mail.ru', displayName: 'Catalog Editor', passwordHash } }),
    ]);
    const [a, b] = await Promise.all([
      prisma.workspace.create({ data: { name: 'Catalog A', slug: 'catalog-a-e2e' } }),
      prisma.workspace.create({ data: { name: 'Catalog B', slug: 'catalog-b-e2e' } }),
    ]);
    await Promise.all([
      prisma.workspaceMembership.create({ data: { workspaceId: a.id, userId: adminA.id, roles: { create: [{ role: 'admin' }] } } }),
      prisma.workspaceMembership.create({ data: { workspaceId: b.id, userId: adminB.id, roles: { create: [{ role: 'admin' }] } } }),
      prisma.catalogGrant.create({ data: { userId: globalEditor.id } }),
    ]);
    const login = async (email: string) => (await request(server).post('/api/v2/auth/login').send({ email, password: 'catalog-pass-123' }).expect(200)).body.session.token;
    const [tokenA, tokenB, globalToken] = await Promise.all([login(adminA.email), login(adminB.email), login(globalEditor.email)]);
    await request(server).get('/api/v2/me').set(auth(globalToken)).expect(200)
      .expect(({ body }) => expect(body.item.catalogManage).toBe(true));
    await request(server).get('/api/v2/me').set(auth(tokenA)).expect(200)
      .expect(({ body }) => expect(body.item.catalogManage).toBe(false));
    const headersA = { ...auth(tokenA), 'X-Active-Role': 'admin' };
    const headersB = { ...auth(tokenB), 'X-Active-Role': 'admin' };
    const create = (path: string, headers: Record<string, string>, key: string, body: object) => request(server).post(path).set(headers).set('Idempotency-Key', key).send(body);

    await create('/api/v2/subjects', headersA, 'global-denied', { code: 'physics', name: 'Физика' }).expect(403);
    const globalSubject = await create('/api/v2/subjects', auth(globalToken), 'global-math', { code: 'math-e2e', name: 'Математика' }).expect(200);
    const localSubject = await create('/api/v2/subjects', headersA, 'local-physics', { workspaceId: a.id, code: 'physics', name: 'Физика' }).expect(200);
    await create('/api/v2/subjects', headersA, 'local-physics', { workspaceId: a.id, code: 'physics', name: 'Физика' }).expect(200)
      .expect(({ body }) => expect(body.item.id).toBe(localSubject.body.item.id));
    await create('/api/v2/subjects', headersA, 'local-physics', { workspaceId: a.id, code: 'chemistry', name: 'Химия' }).expect(409);
    await request(server).get(`/api/v2/subjects/${localSubject.body.item.id}`).set(headersB).expect(404);
    await request(server).patch(`/api/v2/subjects/${localSubject.body.item.id}`).set(headersB).set('If-Match', '0').send({ name: 'Чужой предмет' }).expect(404);
    await request(server).post(`/api/v2/subjects/${localSubject.body.item.id}/archive`).set(headersB).set('If-Match', '0').send({}).expect(404);
    await request(server).get(`/api/v2/subjects?workspaceId=${b.id}`).set(headersB).expect(200)
      .expect(({ body }) => expect(body.items.map((item: { id: string }) => item.id)).not.toContain(localSubject.body.item.id));
    await request(server).get(`/api/v2/subjects?workspaceId=${a.id}`).set(headersA).expect(200)
      .expect(({ body }) => expect(body.items.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([globalSubject.body.item.id, localSubject.body.item.id])));

    const programBody = { workspaceId: a.id, subjectId: globalSubject.body.item.id, examType: 'ege', variant: 'base', code: 'ege-math-base-e2e', name: 'ЕГЭ · математика · база' };
    const program = await create('/api/v2/programs', headersA, 'program-base', programBody).expect(200);
    await request(server).patch(`/api/v2/programs/${program.body.item.id}`).set(headersB).set('If-Match', '0').send({ name: 'Чужая программа' }).expect(404);
    await request(server).post(`/api/v2/programs/${program.body.item.id}/archive`).set(headersB).set('If-Match', '0').send({}).expect(404);
    await create('/api/v2/programs', headersB, 'cross-scope', { ...programBody, workspaceId: b.id, subjectId: localSubject.body.item.id }).expect(422);
    await create('/api/v2/programs', headersA, 'program-profile', { ...programBody, variant: 'profile', code: 'ege-math-profile-e2e', name: 'ЕГЭ · математика · профиль' }).expect(200);
    await create('/api/v2/programs', headersA, 'program-oge', { ...programBody, examType: 'oge', variant: 'general', code: 'oge-math-e2e', name: 'ОГЭ · математика' }).expect(200);
    const version = await create(`/api/v2/programs/${program.body.item.id}/versions`, headersA, 'version-one', { period: '2027', revisionNumber: 1, sourceUrl: 'https://example.org/catalog-2027' }).expect(200);
    const versionId = version.body.item.id;
    await create(`/api/v2/programs/${program.body.item.id}/versions`, headersB, 'foreign-version', { period: '2029', revisionNumber: 1 }).expect(404);
    await request(server).patch(`/api/v2/program-versions/${versionId}`).set(headersB).set('If-Match', '0').send({ notes: 'Чужая правка' }).expect(404);
    await request(server).post(`/api/v2/program-versions/${versionId}/publish`).set(headersB).set('If-Match', '0').send({}).expect(404);
    await request(server).get(`/api/v2/program-versions/${versionId}`).set(headersA).expect(200)
      .expect(({ body }) => expect(body.item.program.id).toBe(program.body.item.id));
    await request(server).post(`/api/v2/program-versions/${versionId}/publish`).set(headersA).set('If-Match', '0').send({}).expect(422);
    const taskBody = { code: 'A-1', title: 'Первое задание', topics: ['Алгебра'], position: 1, kind: 'short_answer', maxScore: 2,
      criteria: [{ code: 'score-1', title: 'Первый балл', maxScore: 1 }, { code: 'score-2', title: 'Второй балл', maxScore: 1 }] };
    await request(server).post(`/api/v2/program-versions/${versionId}/tasks`).set(headersB).set('If-Match', '0').send(taskBody).expect(404);
    await request(server).post(`/api/v2/program-versions/${versionId}/tasks`).set(headersA).set('If-Match', '0')
      .send({ ...taskBody, criteria: [taskBody.criteria[0]] }).expect(422);
    const task = await request(server).post(`/api/v2/program-versions/${versionId}/tasks`).set(headersA).set('If-Match', '0').send(taskBody).expect(200);
    expect(task.body.versionRevision).toBe(1);
    await request(server).post(`/api/v2/program-versions/${versionId}/tasks`).set(headersA).set('If-Match', '0').send({ ...taskBody, code: 'B-2', position: 2 }).expect(412);
    const published = await request(server).post(`/api/v2/program-versions/${versionId}/publish`).set(headersA).set('If-Match', '1').send({}).expect(200);
    expect(published.body.item.status).toBe('published');
    await request(server).patch(`/api/v2/program-versions/${versionId}/tasks/${task.body.item.id}`).set(headersA).set('If-Match', '2').send({ ...taskBody, title: 'Новая редакция' }).expect(409);
    await expect(prisma.$executeRawUnsafe('UPDATE "TaskDefinition" SET "title" = $1 WHERE "id" = $2', 'Direct rewrite', task.body.item.id)).rejects.toThrow();
    await request(server).get(`/api/v2/program-versions/${versionId}/tasks?pageSize=1`).set(headersA).expect(200)
      .expect(({ body }) => expect(body.items[0].title).toBe('Первое задание'));
    await request(server).get(`/api/v2/program-versions/${versionId}`).set(headersB).expect(404);

    const nextVersion = await create(`/api/v2/programs/${program.body.item.id}/versions`, headersA, 'version-two', { period: '2028', revisionNumber: 1, sourceUrl: 'https://example.org/catalog-2028' }).expect(200);
    await expect(prisma.$executeRawUnsafe('UPDATE "TaskDefinition" SET "programVersionId" = $1 WHERE "id" = $2', nextVersion.body.item.id, task.body.item.id)).rejects.toThrow();
    const nextTask = await request(server).post(`/api/v2/program-versions/${nextVersion.body.item.id}/tasks`).set(headersA).set('If-Match', '0')
      .send({ ...taskBody, code: 'X-7', title: 'Переработанное задание' }).expect(200);
    await request(server).post(`/api/v2/program-versions/${nextVersion.body.item.id}/publish`).set(headersA).set('If-Match', '1').send({}).expect(200);
    const mapping = await create('/api/v2/task-mappings', headersA, 'map-tasks', { fromTaskId: task.body.item.id, toTaskId: nextTask.body.item.id, reason: 'Подтверждена эквивалентность заданий двух периодов.' }).expect(200);
    await create('/api/v2/task-mappings', headersB, 'foreign-mapping', { fromTaskId: task.body.item.id, toTaskId: nextTask.body.item.id, reason: 'Недоступное сопоставление заданий.' }).expect(404);
    await request(server).post(`/api/v2/task-mappings/${mapping.body.item.id}/revoke`).set(headersB).set('If-Match', '0').send({ reason: 'Чужой отзыв сопоставления.' }).expect(404);
    await request(server).get(`/api/v2/task-mappings?fromVersionId=${versionId}&toVersionId=${nextVersion.body.item.id}`).set(headersA).expect(200)
      .expect(({ body }) => expect(body.total).toBe(1));
    await request(server).get(`/api/v2/task-mappings?fromVersionId=${versionId}&toVersionId=${nextVersion.body.item.id}`).set(headersB).expect(404);
    await request(server).post(`/api/v2/task-mappings/${mapping.body.item.id}/revoke`).set(headersA).send({ reason: 'Выявлена ошибка соответствия заданий.' }).expect(428);
    await request(server).post(`/api/v2/task-mappings/${mapping.body.item.id}/revoke`).set(headersA).set('If-Match', '0').send({ reason: 'Выявлена ошибка соответствия заданий.' }).expect(200);
    await request(server).get(`/api/v2/task-mappings?fromVersionId=${versionId}&toVersionId=${nextVersion.body.item.id}`).set(headersA).expect(200)
      .expect(({ body }) => expect(body.total).toBe(0));
    await request(server).get(`/api/v2/task-mappings?fromVersionId=${versionId}&toVersionId=${nextVersion.body.item.id}&includeRevoked=true`).set(headersA).expect(200)
      .expect(({ body }) => expect(body.items[0].revocationReason).toBe('Выявлена ошибка соответствия заданий.'));
    const replacement = await create('/api/v2/task-mappings', headersA, 'map-tasks-corrected', { fromTaskId: task.body.item.id, toTaskId: nextTask.body.item.id, reason: 'После повторной проверки соответствие подтверждено.' }).expect(200);
    expect(replacement.body.item.id).not.toBe(mapping.body.item.id);
    await expect(prisma.$executeRawUnsafe('UPDATE "TaskMapping" SET "fromTaskId" = $1, "toTaskId" = $2 WHERE "id" = $3', nextTask.body.item.id, task.body.item.id, replacement.body.item.id)).rejects.toThrow();
    await request(server).post(`/api/v2/program-versions/${versionId}/archive`).set(headersA).set('If-Match', '2').send({}).expect(200);
    await request(server).get(`/api/v2/program-versions/${versionId}/tasks`).set(headersA).expect(200);
    expect(await prisma.catalogAuditEvent.count({ where: { workspaceId: a.id } })).toBeGreaterThanOrEqual(8);
    await prisma.catalogGrant.delete({ where: { userId: globalEditor.id } });
    await request(server).get('/api/v2/me').set(auth(globalToken)).expect(200)
      .expect(({ body }) => expect(body.item.catalogManage).toBe(false));
    await create('/api/v2/subjects', auth(globalToken), 'revoked-grant', { code: 'revoked-test', name: 'Недоступно' }).expect(403);
  });

  it('manages courses and enrollments across subjects, roles and workspaces', async () => {
    const passwordHash = await bcrypt.hash('course-pass-123', 4);
    const createUser = async (email: string, name: string) => prisma.user.create({ data: { email, displayName: name, passwordHash } });
    const [admin, otherAdmin, teacher, secondTeacher, student, secondStudent, thirdStudent] = await Promise.all([
      createUser('course-admin-e2e@mail.ru', 'Course Admin'),
      createUser('course-other-admin-e2e@mail.ru', 'Other Admin'),
      createUser('course-teacher-e2e@mail.ru', 'Course Teacher'),
      createUser('course-second-teacher-e2e@mail.ru', 'Second Teacher'),
      createUser('course-student-e2e@mail.ru', 'Course Student'),
      createUser('course-second-student-e2e@mail.ru', 'Second Student'),
      createUser('course-third-student-e2e@mail.ru', 'Third Student'),
    ]);
    const [a, b] = await Promise.all([
      prisma.workspace.create({ data: { name: 'Course A', slug: 'course-a-e2e' } }),
      prisma.workspace.create({ data: { name: 'Course B', slug: 'course-b-e2e' } }),
    ]);
    const member = (workspaceId: string, userId: string, role: 'admin' | 'teacher' | 'student') =>
      prisma.workspaceMembership.create({ data: { workspaceId, userId, roles: { create: [{ role }] } } });
    const [adminMember, teacherMember, studentMember] = await Promise.all([
      member(a.id, admin.id, 'admin'), member(a.id, teacher.id, 'teacher'), member(a.id, student.id, 'student'),
      member(a.id, secondTeacher.id, 'teacher'), member(a.id, secondStudent.id, 'student'), member(a.id, thirdStudent.id, 'student'),
      member(b.id, otherAdmin.id, 'admin'), member(b.id, student.id, 'student'),
    ]);
    const subject = await prisma.subject.create({ data: { scopeKey: `w:${a.id}`, workspaceId: a.id, code: 'course-physics', name: 'Физика' } });
    const program = await prisma.examProgram.create({ data: { scopeKey: `w:${a.id}`, workspaceId: a.id, subjectId: subject.id, code: 'course-ege-physics', examType: 'ege', variant: 'profile', name: 'ЕГЭ · физика' } });
    const version = await prisma.programVersion.create({ data: { programId: program.id, period: '2027', revisionNumber: 1, status: 'published', publishedAt: new Date() } });
    const draft = await prisma.programVersion.create({ data: { programId: program.id, period: '2028', revisionNumber: 1 } });
    const login = async (email: string) => (await request(server).post('/api/v2/auth/login').send({ email, password: 'course-pass-123' }).expect(200)).body.session.token;
    const [adminToken, otherToken, teacherToken, studentToken, secondToken] = await Promise.all([
      login(admin.email), login(otherAdmin.email), login(teacher.email), login(student.email), login(secondStudent.email),
    ]);
    const headers = (token: string, role: string) => ({ ...auth(token), 'X-Active-Role': role });
    const adminHeaders = headers(adminToken, 'admin');
    const base = `/api/v2/workspaces/${a.id}/courses`;
    const createBody = { programVersionId: version.id, title: 'Физика · группа А', defaultFormat: 'group', capacity: 2, startsOn: '2026-10-01', endsOn: '2027-06-01', timezone: 'Asia/Omsk', leadTeacherUserId: teacher.id };
    await request(server).post(base).set(adminHeaders).set('Idempotency-Key', 'draft-denied').send({ ...createBody, programVersionId: draft.id }).expect(422);
    await request(server).post(`/api/v2/workspaces/${b.id}/courses`).set(headers(otherToken, 'admin')).set('Idempotency-Key', 'foreign-program').send(createBody).expect(422);
    const created = await request(server).post(base).set(adminHeaders).set('Idempotency-Key', 'course-a').send(createBody).expect(200);
    const course = created.body.item;
    expect(course).toMatchObject({ programVersionId: version.id, defaultFormat: 'group', status: 'draft', activeEnrollmentCount: 0, legacy: false });
    await request(server).post(base).set(adminHeaders).set('Idempotency-Key', 'course-a').send(createBody).expect(200)
      .expect(({ body }) => expect(body.item.id).toBe(course.id));
    await request(server).post(base).set(adminHeaders).set('Idempotency-Key', 'course-a').send({ ...createBody, title: 'Other name' }).expect(409);
    await prisma.idempotencyRecord.update({ where: { actorUserId_route_key: { actorUserId: admin.id, route: `courses:${a.id}`, key: 'course-a' } }, data: { expiresAt: new Date(0) } });
    await request(server).post(base).set(adminHeaders).set('Idempotency-Key', 'course-a')
      .send({ ...createBody, title: 'Физика · новый срок ключа' }).expect(200)
      .expect(({ body }) => expect(body.item.id).not.toBe(course.id));
    await request(server).post(base).set(headers(teacherToken, 'teacher')).set('Idempotency-Key', 'teacher-denied').send(createBody).expect(403);
    await request(server).get(`${base}/${course.id}`).set(headers(otherToken, 'admin')).expect(404);
    await request(server).get(`${base}/${course.id}`).set(headers(studentToken, 'student')).expect(404);
    await request(server).get(base).set(headers(teacherToken, 'teacher')).expect(200)
      .expect(({ body }) => expect(body.items.map((item: { id: string }) => item.id)).toContain(course.id));

    const lead = (await request(server).get(`${base}/${course.id}/teachers`).set(adminHeaders).expect(200)).body.items[0];
    await request(server).patch(`${base}/${course.id}/teachers/${lead.id}`).set(adminHeaders).set('If-Match', '0').send({ status: 'ended' }).expect(200);
    await request(server).post(`${base}/${course.id}/activate`).set(adminHeaders).set('If-Match', '0').send({}).expect(409);
    const replacement = await request(server).post(`${base}/${course.id}/teachers`).set(adminHeaders).set('Idempotency-Key', 'teacher-two').send({ teacherUserId: secondTeacher.id, role: 'lead' }).expect(200);
    expect(replacement.body.item.role).toBe('lead');
    await request(server).patch(`${base}/${course.id}/teachers/${replacement.body.item.id}`).set(adminHeaders).set('If-Match', '9').send({ role: 'assistant' }).expect(412);
    const activated = await request(server).post(`${base}/${course.id}/activate`).set(adminHeaders).set('If-Match', '0').send({}).expect(200);
    expect(activated.body.item.status).toBe('active');
    const secondTeacherMember = await prisma.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: a.id, userId: secondTeacher.id } } });
    await request(server).post(`/api/v2/workspaces/${a.id}/members/${secondTeacherMember.id}/roles/teacher/revoke`).set(adminHeaders).set('If-Match', '0')
      .send({ reason: 'Передача курса другому преподавателю' }).expect(409);
    await request(server).post(`/api/v2/workspaces/${a.id}/members/${secondTeacherMember.id}/suspend`).set(adminHeaders).set('If-Match', '0')
      .send({ reason: 'Временная блокировка преподавателя' }).expect(409);
    await request(server).post(`${base}/${course.id}/activate`).set(adminHeaders).set('If-Match', '0').send({}).expect(412);

    const enroll = (userId: string, key: string) => request(server).post(`${base}/${course.id}/enrollments`).set(adminHeaders).set('Idempotency-Key', key)
      .send({ studentUserId: userId, status: 'active', goal: 'Решать профильные задачи' });
    const first = await enroll(student.id, 'first').expect(200);
    const second = await enroll(secondStudent.id, 'second').expect(200);
    expect(first.body.item.note).toBe('');
    await enroll(thirdStudent.id, 'third').expect(409).expect(({ body }) => expect(body.code).toBe('course_full'));
    await request(server).get(`${base}/${course.id}/enrollments`).set(headers(studentToken, 'student')).expect(200)
      .expect(({ body }) => { expect(body.items).toHaveLength(1); expect(body.items[0].id).toBe(first.body.item.id); expect(body.items[0]).not.toHaveProperty('note'); });
    await request(server).get(`${base}/${course.id}/enrollments/${second.body.item.id}`).set(headers(studentToken, 'student')).expect(404);
    await request(server).get(`${base}/${course.id}`).set(headers(studentToken, 'student')).expect(200)
      .expect(({ body }) => expect(body.item.activeEnrollmentCount).toBeNull());
    await request(server).patch(`${base}/${course.id}/enrollments/${first.body.item.id}`).set(headers(studentToken, 'student')).set('If-Match', '0').send({ status: 'withdrawn' }).expect(403);
    await request(server).patch(`${base}/${course.id}/enrollments/${first.body.item.id}`).set(adminHeaders).set('If-Match', '0').send({ status: 'withdrawn' }).expect(200);
    await request(server).patch(`${base}/${course.id}/enrollments/${first.body.item.id}`).set(adminHeaders).set('If-Match', '0').send({ status: 'active' }).expect(412);
    await request(server).get(`${base}/${course.id}`).set(headers(studentToken, 'student')).expect(404);
    await enroll(thirdStudent.id, 'third-retry').expect(200);
    await request(server).patch(`${base}/${course.id}`).set(adminHeaders).set('If-Match', '1').send({ capacity: 1 }).expect(409);
    await request(server).patch(`${base}/${course.id}`).set(adminHeaders).set('If-Match', '0').send({ title: 'Физика · группа Б' }).expect(412);
    const batchCourse = await request(server).post(base).set(adminHeaders).set('Idempotency-Key', 'batch-course')
      .send({ ...createBody, title: 'Физика · набор Б' }).expect(200);
    await request(server).post(`${base}/${batchCourse.body.item.id}/activate`).set(adminHeaders).set('If-Match', '0').send({}).expect(200);
    const batchPath = `/api/v2/workspaces/${a.id}/enrollment-batches`;
    const batchBody = { courseId: batchCourse.body.item.id, studentUserIds: [student.id, secondStudent.id, thirdStudent.id], status: 'active' };
    await request(server).post(`${batchPath}/preview`).set(headers(teacherToken, 'teacher')).send(batchBody).expect(403);
    await request(server).post(`/api/v2/workspaces/${b.id}/enrollment-batches/preview`).set(headers(otherToken, 'admin')).send(batchBody).expect(404);
    const preview = await request(server).post(`${batchPath}/preview`).set(adminHeaders).send(batchBody).expect(200);
    expect(preview.body).toMatchObject({ canApply: false, availableSeats: 2 });
    expect(preview.body.items[2].reason).toContain('свободных мест');
    await request(server).post(batchPath).set(adminHeaders).set('Idempotency-Key', 'batch-overflow').send(batchBody).expect(409);
    expect(await prisma.enrollment.count({ where: { courseId: batchCourse.body.item.id } })).toBe(0);
    const allowedBatch = { ...batchBody, studentUserIds: [student.id, secondStudent.id] };
    await request(server).post(`${batchPath}/preview`).set(adminHeaders).send(allowedBatch).expect(200)
      .expect(({ body }) => expect(body.canApply).toBe(true));
    const applied = await request(server).post(batchPath).set(adminHeaders).set('Idempotency-Key', 'batch-two').send(allowedBatch).expect(200);
    expect(applied.body.appliedCount).toBe(2);
    await request(server).post(batchPath).set(adminHeaders).set('Idempotency-Key', 'batch-two').send(allowedBatch).expect(200)
      .expect(({ body }) => expect(body.items.map((item: { id: string }) => item.id)).toEqual(applied.body.items.map((item: { id: string }) => item.id)));
    await request(server).post(batchPath).set(adminHeaders).set('Idempotency-Key', 'batch-two').send(batchBody).expect(409);
    const oneSeat = await request(server).post(base).set(adminHeaders).set('Idempotency-Key', 'one-seat')
      .send({ ...createBody, title: 'Физика · один на пробу', capacity: 1 }).expect(200);
    await request(server).post(`${base}/${oneSeat.body.item.id}/activate`).set(adminHeaders).set('If-Match', '0').send({}).expect(200);
    const simultaneous = await Promise.all([student.id, secondStudent.id].map((userId, index) => request(server).post(`${base}/${oneSeat.body.item.id}/enrollments`)
      .set(adminHeaders).set('Idempotency-Key', `last-seat-${index}`).send({ studentUserId: userId, status: 'active' })));
    expect(simultaneous.map(result => result.status).sort()).toEqual([200, 409]);
    expect(await prisma.enrollment.count({ where: { courseId: oneSeat.body.item.id, status: 'active' } })).toBe(1);
    const archivedDraft = await request(server).post(base).set(adminHeaders).set('Idempotency-Key', 'archive-draft')
      .send({ ...createBody, title: 'Физика · не состоялся' }).expect(200);
    const archivedPath = `${base}/${archivedDraft.body.item.id}`;
    const invitation = await request(server).post(`${archivedPath}/enrollments`).set(adminHeaders).set('Idempotency-Key', 'archive-invite')
      .send({ studentUserId: student.id, status: 'invited' }).expect(200);
    await request(server).post(`${archivedPath}/archive`).set(adminHeaders).set('If-Match', '0').send({}).expect(200);
    await request(server).get(`${archivedPath}/enrollments/${invitation.body.item.id}`).set(adminHeaders).expect(200)
      .expect(({ body }) => expect(body.item.status).toBe('withdrawn'));
    await request(server).post(`${base}/${course.id}/pause`).set(adminHeaders).set('If-Match', '1').send({}).expect(200);
    await prisma.programVersion.update({ where: { id: version.id }, data: { status: 'archived' } });
    await request(server).post(`${base}/${course.id}/activate`).set(adminHeaders).set('If-Match', '2').send({}).expect(200);
    expect(await prisma.workspaceAuditEvent.count({ where: { workspaceId: a.id, targetType: 'course' } })).toBeGreaterThanOrEqual(2);
    await expect(prisma.courseTeacher.create({ data: { workspaceId: b.id, courseId: course.id, membershipId: teacherMember.id, role: 'assistant', startsOn: new Date('2026-10-01') } })).rejects.toThrow();
    expect(adminMember.workspaceId).toBe(a.id);
    expect(studentMember.workspaceId).toBe(a.id);
    await request(server).get(base).set(headers(secondToken, 'student')).expect(200)
      .expect(({ body }) => expect(body.items.map((item: { id: string }) => item.id)).toContain(course.id));
  });

  it('schedules group and individual lessons with cross-course conflicts, attendance, privacy and history', async () => {
    const passwordHash = await bcrypt.hash('lessons-pass-123', 4);
    const createUser = (email: string, displayName: string) => prisma.user.create({ data: { email, displayName, passwordHash } });
    const [admin, teacherA, teacherB, studentA, studentB, studentC, outsider] = await Promise.all([
      createUser('lessons-admin-e2e@mail.ru', 'Lessons Admin'), createUser('lessons-teacher-a-e2e@mail.ru', 'Teacher A'),
      createUser('lessons-teacher-b-e2e@mail.ru', 'Teacher B'), createUser('lessons-student-a-e2e@mail.ru', 'Student A'),
      createUser('lessons-student-b-e2e@mail.ru', 'Student B'), createUser('lessons-student-c-e2e@mail.ru', 'Student C'),
      createUser('lessons-outsider-e2e@mail.ru', 'Outsider'),
    ]);
    const workspace = await prisma.workspace.create({ data: { name: 'Lessons Workspace', slug: 'lessons-e2e', timezone: 'UTC' } });
    const other = await prisma.workspace.create({ data: { name: 'Other Lessons Workspace', slug: 'lessons-other-e2e', timezone: 'UTC' } });
    const member = (workspaceId: string, userId: string, role: 'admin' | 'teacher' | 'student') =>
      prisma.workspaceMembership.create({ data: { workspaceId, userId, roles: { create: [{ role }] } } });
    const [adminMember, teacherAMember, teacherBMember, studentAMember, studentBMember, studentCMember] = await Promise.all([
      member(workspace.id, admin.id, 'admin'), member(workspace.id, teacherA.id, 'teacher'), member(workspace.id, teacherB.id, 'teacher'),
      member(workspace.id, studentA.id, 'student'), member(workspace.id, studentB.id, 'student'), member(workspace.id, studentC.id, 'student'),
      member(other.id, outsider.id, 'admin'),
    ]);
    const today = new Date(new Date().toISOString().slice(0, 10));
    const plus = (days: number, hour: number) => new Date(today.getTime() + days * 86400000 + hour * 3600000);
    const programVersion = await prisma.programVersion.findUniqueOrThrow({ where: { id: 'legacy-version-oge-math' } });
    const makeCourse = (title: string, defaultFormat: 'individual' | 'group') => prisma.course.create({ data: {
      workspaceId: workspace.id, programVersionId: programVersion.id, title, defaultFormat, capacity: 5,
      startsOn: today, endsOn: plus(60, 0), timezone: 'UTC', status: 'active',
    } });
    const [group, secondCourse, thirdCourse] = await Promise.all([
      makeCourse('Math Group', 'group'), makeCourse('Second Subject', 'group'), makeCourse('Teacher Conflict', 'group'),
    ]);
    const teacherLink = (courseId: string, membershipId: string) => prisma.courseTeacher.create({ data: {
      workspaceId: workspace.id, courseId, membershipId, role: 'lead', startsOn: today,
    } });
    const enroll = (courseId: string, membershipId: string) => prisma.enrollment.create({ data: {
      workspaceId: workspace.id, courseId, membershipId, status: 'active', startsOn: today,
    } });
    const [groupTeacher, secondTeacher, thirdTeacher, groupStudentA, groupStudentB, secondStudentA, thirdStudentC] = await Promise.all([
      teacherLink(group.id, teacherAMember.id), teacherLink(secondCourse.id, teacherBMember.id), teacherLink(thirdCourse.id, teacherAMember.id),
      enroll(group.id, studentAMember.id), enroll(group.id, studentBMember.id), enroll(secondCourse.id, studentAMember.id), enroll(thirdCourse.id, studentCMember.id),
    ]);
    const login = async (email: string) => (await request(server).post('/api/v2/auth/login').send({ email, password: 'lessons-pass-123' }).expect(200)).body.session.token;
    const [adminToken, teacherToken, studentAToken, studentBToken, outsiderToken] = await Promise.all([
      login(admin.email), login(teacherA.email), login(studentA.email), login(studentB.email), login(outsider.email),
    ]);
    const headers = (token: string, role: string) => ({ ...auth(token), 'X-Active-Role': role });
    const adminHeaders = headers(adminToken, 'admin');
    const path = `/api/v2/workspaces/${workspace.id}/lessons`;
    const slot = (days: number, hour: number) => ({ startAt: plus(days, hour).toISOString(), endAt: plus(days, hour + 1).toISOString() });
    const zoneCourse = await prisma.course.create({ data: {
      workspaceId: workspace.id, programVersionId: programVersion.id, title: 'Timezone boundary', defaultFormat: 'group', capacity: 2,
      startsOn: today, endsOn: plus(1, 0), timezone: 'Asia/Omsk', status: 'active',
    } });
    const [zoneTeacher, zoneStudent] = await Promise.all([teacherLink(zoneCourse.id, teacherAMember.id), enroll(zoneCourse.id, studentBMember.id)]);
    await request(server).post(`${path}/preview`).set(adminHeaders).send({
      courseId: zoneCourse.id, topic: 'Outside course local date', ...slot(1, 21), timezone: 'UTC', format: 'individual',
      teacherLinkIds: [zoneTeacher.id], participantEnrollmentIds: [zoneStudent.id],
    }).expect(422);
    const groupBody = { courseId: group.id, topic: 'Equations', ...slot(3, 12), timezone: 'UTC', format: 'group',
      teacherLinkIds: [groupTeacher.id], participantEnrollmentIds: [groupStudentA.id, groupStudentB.id], note: 'Private team note' };
    await request(server).post(path).set(adminHeaders).send(groupBody).expect(400);
    await request(server).post(`${path}/preview`).set(headers(studentAToken, 'student')).send(groupBody).expect(403);
    await request(server).post(`${path}/preview`).set(adminHeaders).send(groupBody).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ canCreate: true, participantCount: 2, teacherCount: 1 }));
    const created = await request(server).post(path).set(adminHeaders).set('Idempotency-Key', 'group-one').send(groupBody).expect(200);
    const lessonId = created.body.item.id;
    expect(created.body.item).toMatchObject({ courseId: group.id, format: 'group', status: 'planned', revision: 0 });
    await request(server).post(path).set(adminHeaders).set('Idempotency-Key', 'group-one').send(groupBody).expect(200)
      .expect(({ body }) => expect(body.item.id).toBe(lessonId));
    await request(server).post(path).set(adminHeaders).set('Idempotency-Key', 'group-one').send({ ...groupBody, topic: 'Different' }).expect(409);
    const sameStudent = { ...groupBody, courseId: secondCourse.id, teacherLinkIds: [secondTeacher.id], participantEnrollmentIds: [secondStudentA.id] };
    await request(server).post(`${path}/preview`).set(adminHeaders).send(sameStudent).expect(200)
      .expect(({ body }) => expect(body.conflicts).toContainEqual({ userId: studentA.id, kind: 'student' }));
    await request(server).post(path).set(adminHeaders).set('Idempotency-Key', 'student-conflict').send(sameStudent).expect(409);
    const sameTeacher = { ...groupBody, courseId: thirdCourse.id, teacherLinkIds: [thirdTeacher.id], participantEnrollmentIds: [thirdStudentC.id] };
    await request(server).post(`${path}/preview`).set(adminHeaders).send(sameTeacher).expect(200)
      .expect(({ body }) => expect(body.conflicts).toContainEqual({ userId: teacherA.id, kind: 'teacher' }));
    await request(server).post(path).set(adminHeaders).set('Idempotency-Key', 'teacher-conflict').send(sameTeacher).expect(409);
    await request(server).get(`${path}/${lessonId}`).set(headers(outsiderToken, 'admin')).expect(404);
    await request(server).get(`${path}/${lessonId}`).set(headers(studentAToken, 'student')).expect(200).expect(({ body }) => {
      expect(body.item.participants).toHaveLength(1);
      expect(body.item.participants[0]).not.toHaveProperty('userId');
      expect(body.item).not.toHaveProperty('note');
    });
    const range = `from=${encodeURIComponent(plus(2, 0).toISOString())}&to=${encodeURIComponent(plus(10, 0).toISOString())}`;
    await request(server).get(`${path}?${range}`).set(headers(studentBToken, 'student')).expect(200)
      .expect(({ body }) => expect(body.items.map((item: { id: string }) => item.id)).toContain(lessonId));
    const consultation = { ...groupBody, topic: 'Individual consultation', ...slot(4, 12), format: 'individual', participantEnrollmentIds: [groupStudentA.id] };
    const solo = await request(server).post(path).set(headers(teacherToken, 'teacher')).set('Idempotency-Key', 'consultation').send(consultation).expect(200);
    await request(server).get(`${path}/${solo.body.item.id}`).set(headers(studentBToken, 'student')).expect(404);
    await request(server).get(`${path}?${range}`).set(headers(studentBToken, 'student')).expect(200)
      .expect(({ body }) => expect(body.items.map((item: { id: string }) => item.id)).not.toContain(solo.body.item.id));
    await request(server).post(`/api/v2/workspaces/${workspace.id}/courses/${group.id}/complete`).set(adminHeaders).set('If-Match', '0').send({}).expect(409);
    await request(server).patch(`/api/v2/workspaces/${workspace.id}/courses/${group.id}`).set(adminHeaders).set('If-Match', '0')
      .send({ endsOn: plus(2, 0).toISOString().slice(0, 10) }).expect(409)
      .expect(({ body }) => expect(body.code).toBe('lessons_after_course_end'));
    await request(server).patch(`${path}/${lessonId}`).set(adminHeaders).set('If-Match', '9').send({ topic: 'New topic' }).expect(412);
    await request(server).patch(`${path}/${lessonId}`).set(adminHeaders).set('If-Match', '0').send({ topic: 'Revised equations' }).expect(200)
      .expect(({ body }) => expect(body.item.revision).toBe(1));
    await prisma.lesson.update({ where: { id: lessonId }, data: { startAt: plus(-1, 12), endAt: plus(-1, 13) } });
    await request(server).post(`${path}/${lessonId}/complete`).set(adminHeaders).set('If-Match', '1')
      .send({ attendance: [{ enrollmentId: groupStudentA.id, attendance: 'present' }] }).expect(422);
    const completed = await request(server).post(`${path}/${lessonId}/complete`).set(adminHeaders).set('If-Match', '1').send({
      attendance: [{ enrollmentId: groupStudentA.id, attendance: 'present' }, { enrollmentId: groupStudentB.id, attendance: 'absent' }], completionComment: 'Covered equations',
    }).expect(200);
    expect(completed.body.item).toMatchObject({ status: 'completed', revision: 2 });
    await request(server).post(`${path}/${lessonId}/attendance-corrections`).set(adminHeaders).set('If-Match', '2')
      .send({ enrollmentId: groupStudentB.id, attendance: 'excused', reason: 'Medical appointment confirmed' }).expect(200)
      .expect(({ body }) => expect(body.item.participants.find((item: { enrollmentId: string }) => item.enrollmentId === groupStudentB.id).attendance).toBe('excused'));
    expect(await prisma.workspaceAuditEvent.count({ where: { workspaceId: workspace.id, targetId: lessonId } })).toBe(4);
    const canceled = await request(server).post(`${path}/${solo.body.item.id}/cancel`).set(adminHeaders).set('If-Match', '0')
      .send({ reason: 'Student requested a different date' }).expect(200);
    expect(canceled.body.item.status).toBe('canceled');
    await request(server).post(path).set(adminHeaders).set('Idempotency-Key', 'reuse-after-cancel').send(consultation).expect(200);
    await request(server).patch(`/api/v2/workspaces/${workspace.id}/courses/${group.id}/enrollments/${groupStudentA.id}`)
      .set(adminHeaders).set('If-Match', '0').send({ status: 'withdrawn' }).expect(409)
      .expect(({ body }) => expect(body.code).toBe('future_lessons'));
    const simultaneousSlot = slot(6, 12);
    const simultaneous = await Promise.all([
      request(server).post(path).set(adminHeaders).set('Idempotency-Key', 'parallel-a').send({ ...consultation, ...simultaneousSlot }),
      request(server).post(path).set(adminHeaders).set('Idempotency-Key', 'parallel-b').send({ ...sameStudent, ...simultaneousSlot, format: 'individual' }),
    ]);
    expect(simultaneous.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.lesson.count({ where: { startAt: plus(6, 12), courseId: { in: [group.id, secondCourse.id] } } })).toBe(1);
    expect(adminMember.workspaceId).toBe(workspace.id);
  });

  it('runs group assignments, attempts, reviews, material publication and file ACL through the real API', async () => {
    const passwordHash = await bcrypt.hash('work-pass-123', 4);
    const makeUser = (email: string) => prisma.user.create({ data: { email, displayName: email.split('@')[0], passwordHash } });
    const [admin, teacher, otherTeacher, studentA, studentB, studentC] = await Promise.all([
      makeUser('work-admin-e2e@mail.ru'), makeUser('work-teacher-e2e@mail.ru'), makeUser('work-other-teacher-e2e@mail.ru'),
      makeUser('work-a-e2e@mail.ru'), makeUser('work-b-e2e@mail.ru'), makeUser('work-c-e2e@mail.ru'),
    ]);
    const workspace = await prisma.workspace.create({ data: { name: 'Works E2E', slug: 'works-e2e', timezone: 'UTC' } });
    const member = (userId: string, role: 'admin' | 'teacher' | 'student') => prisma.workspaceMembership.create({ data: { workspaceId: workspace.id, userId, roles: { create: [{ role }] } } });
    const [adminMember, teacherMember, otherTeacherMember, aMember, bMember, cMember] = await Promise.all([
      member(admin.id, 'admin'), member(teacher.id, 'teacher'), member(otherTeacher.id, 'teacher'),
      member(studentA.id, 'student'), member(studentB.id, 'student'), member(studentC.id, 'student'),
    ]);
    const subject = await prisma.subject.create({ data: { scopeKey: 'global', code: 'work-physics', name: 'Физика' } });
    const program = await prisma.examProgram.create({ data: { scopeKey: 'global', subjectId: subject.id, code: 'work-ege-physics', examType: 'ege', variant: 'base', name: 'ЕГЭ физика' } });
    const version = await prisma.programVersion.create({ data: { programId: program.id, period: '2026', revisionNumber: 1, status: 'draft' } });
    const task = await prisma.taskDefinition.create({ data: { programVersionId: version.id, code: 'T01', title: 'Механика', position: 1, kind: 'extended_answer', maxScore: 3, criteria: [{ code: 'c1', title: 'Решение', maxScore: 2 }, { code: 'c2', title: 'Ответ', maxScore: 1 }] } });
    await prisma.programVersion.update({ where: { id: version.id }, data: { status: 'published', publishedAt: new Date() } });
    const today = new Date(new Date().toISOString().slice(0, 10));
    const course = await prisma.course.create({ data: { workspaceId: workspace.id, programVersionId: version.id, title: 'ЕГЭ физика · группа', defaultFormat: 'group', capacity: 5, startsOn: today, timezone: 'UTC', status: 'active' } });
    await prisma.courseTeacher.create({ data: { workspaceId: workspace.id, courseId: course.id, membershipId: teacherMember.id, role: 'lead', startsOn: today } });
    const enroll = (membershipId: string) => prisma.enrollment.create({ data: { workspaceId: workspace.id, courseId: course.id, membershipId, status: 'active', startsOn: today } });
    const [a, b, c] = await Promise.all([enroll(aMember.id), enroll(bMember.id), enroll(cMember.id)]);
    const { AuthService } = await import('../../src/auth/auth.service');
    const login = async (email: string) => (await app.get(AuthService).signAccountSession((await prisma.user.findUniqueOrThrow({ where: { email } })).id)).token;
    const [adminToken, teacherToken, otherTeacherToken, aToken, bToken, cToken] = await Promise.all([
      login(admin.email), login(teacher.email), login(otherTeacher.email), login(studentA.email), login(studentB.email), login(studentC.email),
    ]);
    const headers = (token: string, role: string) => ({ ...auth(token), 'X-Active-Role': role });
    const teacherHeaders = headers(teacherToken, 'teacher');
    const aHeaders = headers(aToken, 'student');
    const bHeaders = headers(bToken, 'student');
    const cHeaders = headers(cToken, 'student');
    const path = `/api/v2/workspaces/${workspace.id}`;
    const dueAt = new Date(Date.now() + 8 * 86400000).toISOString();
    const createBody = { courseId: course.id, title: 'Механика · работа 1', instructions: 'Решить задачу и приложить расчёт.', taskDefinitionIds: [task.id], dueAt, fileIds: [] };
    await request(server).post(`${path}/assignments`).set(teacherHeaders).send(createBody).expect(400);
    await request(server).post(`${path}/assignments`).set(headers(otherTeacherToken, 'teacher')).set('Idempotency-Key', 'wrong-course').send(createBody).expect(404);
    await request(server).post(`${path}/assignments`).set(teacherHeaders).set('Idempotency-Key', 'bad-task').send({ ...createBody, taskDefinitionIds: ['foreign-task'] }).expect(422);
    const created = await request(server).post(`${path}/assignments`).set(teacherHeaders).set('Idempotency-Key', 'work-one').send(createBody).expect(200);
    const assignmentId = created.body.item.id;
    await request(server).post(`${path}/assignments`).set(teacherHeaders).set('Idempotency-Key', 'work-one').send(createBody).expect(200)
      .expect(({ body }) => expect(body.item.id).toBe(assignmentId));
    await request(server).get(`${path}/assignments`).set(aHeaders).expect(200).expect(({ body }) => expect(body.items).toHaveLength(0));
    await request(server).post(`${path}/assignments/${assignmentId}/publish`).set(teacherHeaders).set('If-Match', '0').set('Idempotency-Key', 'publish-one')
      .send({ recipientEnrollmentIds: [a.id, b.id] }).expect(200);
    await request(server).post(`${path}/assignments/${assignmentId}/publish`).set(teacherHeaders).set('If-Match', '0').set('Idempotency-Key', 'publish-one')
      .send({ recipientEnrollmentIds: [a.id, b.id] }).expect(200);
    await request(server).get(`${path}/assignments`).set(cHeaders).expect(200).expect(({ body }) => expect(body.items).toHaveLength(0));
    await request(server).get(`${path}/assignments/${assignmentId}/recipients`).set(aHeaders).expect(200)
      .expect(({ body }) => { expect(body.total).toBe(1); expect(body.items[0]).not.toHaveProperty('displayName'); });
    const recipients = await request(server).get(`${path}/assignments/${assignmentId}/recipients`).set(teacherHeaders).expect(200);
    const recipientA = recipients.body.items.find((item: any) => item.enrollmentId === a.id);
    const recipientB = recipients.body.items.find((item: any) => item.enrollmentId === b.id);
    await request(server).get(`${path}/assignment-recipients/${recipientA.id}/submissions`).set(bHeaders).expect(404);
    await request(server).get(`${path}/assignment-recipients/${recipientA.id}/submissions`).set(headers(adminToken, 'admin')).expect(404);
    const upload = await request(server).post(`${path}/files`).set(aHeaders).attach('file', Buffer.from('private work answer'), 'answer.txt').expect(200);
    const answerFile = upload.body.item;
    expect(answerFile.checksum).toMatch(/^[0-9a-f]{64}$/);
    await request(server).get(`${path}/files/${answerFile.id}/download`).set(bHeaders).expect(404);
    await request(server).get(`${path}/files/${answerFile.id}/download`).set(headers(adminToken, 'admin')).expect(404);
    await request(server).get(`/files/${answerFile.id}/download`).set(auth(teacherToken)).expect(401);
    const submission = await request(server).post(`${path}/assignment-recipients/${recipientA.id}/submissions`).set(aHeaders)
      .set('If-Match', '0').set('Idempotency-Key', 'submit-one').send({ text: 'Расчёт приложен.', fileIds: [answerFile.id] }).expect(200);
    expect(submission.body.item.status).toBe('submitted');
    await request(server).post(`${path}/assignment-recipients/${recipientA.id}/submissions`).set(aHeaders)
      .set('If-Match', '0').set('Idempotency-Key', 'submit-one').send({ text: 'Расчёт приложен.', fileIds: [answerFile.id] }).expect(200);
    await request(server).get(`${path}/files/${answerFile.id}/download`).set(teacherHeaders).expect(200);
    const attempts = await request(server).get(`${path}/assignment-recipients/${recipientA.id}/submissions`).set(teacherHeaders).expect(200);
    expect(attempts.body.total).toBe(1);
    const submissionId = attempts.body.items[0].id;
    const reviewBody = { decision: 'rework', comment: 'Уточните последний шаг.', scores: [{ taskDefinitionId: task.id, criterionCode: 'c1', score: 1 }, { taskDefinitionId: task.id, criterionCode: 'c2', score: 0 }], fileIds: [] };
    await request(server).post(`${path}/submissions/${submissionId}/reviews`).set(headers(adminToken, 'admin')).set('If-Match', '1').set('Idempotency-Key', 'admin-review').send(reviewBody).expect(404);
    await request(server).post(`${path}/submissions/${submissionId}/reviews`).set(teacherHeaders).set('If-Match', '1').set('Idempotency-Key', 'invalid-score')
      .send({ ...reviewBody, scores: [{ taskDefinitionId: task.id, criterionCode: 'c1', score: 4 }] }).expect(422);
    const drafted = await request(server).post(`${path}/submissions/${submissionId}/reviews`).set(teacherHeaders).set('If-Match', '1').set('Idempotency-Key', 'draft-one').send(reviewBody).expect(200);
    const reviewId = drafted.body.item.id;
    await request(server).get(`${path}/assignment-recipients/${recipientA.id}/submissions`).set(aHeaders).expect(200)
      .expect(({ body }) => expect(body.items[0].reviews).toHaveLength(0));
    await request(server).post(`${path}/reviews/${reviewId}/publish`).set(teacherHeaders).set('If-Match', '0').set('Idempotency-Key', 'review-publish-one').send({}).expect(200);
    await request(server).get(`${path}/assignment-recipients/${recipientA.id}/submissions`).set(aHeaders).expect(200)
      .expect(({ body }) => expect(body.items[0].reviews[0].decision).toBe('rework'));
    await request(server).post(`${path}/assignment-recipients/${recipientA.id}/submissions`).set(aHeaders)
      .set('If-Match', '3').set('Idempotency-Key', 'submit-two').send({ text: 'Исправленный ответ.', fileIds: [] }).expect(200);
    const latest = await request(server).get(`${path}/assignment-recipients/${recipientA.id}/submissions`).set(teacherHeaders).expect(200);
    expect(latest.body.total).toBe(2);
    const secondId = latest.body.items[0].id;
    const accepted = await request(server).post(`${path}/submissions/${secondId}/reviews`).set(teacherHeaders)
      .set('If-Match', '4').set('Idempotency-Key', 'draft-two').send({ ...reviewBody, decision: 'accepted', comment: 'Верно.' }).expect(200);
    await request(server).post(`${path}/reviews/${accepted.body.item.id}/publish`).set(teacherHeaders).set('If-Match', '0').set('Idempotency-Key', 'publish-two').send({}).expect(200);
    const correction = await request(server).post(`${path}/submissions/${secondId}/reviews`).set(teacherHeaders)
      .set('If-Match', '6').set('Idempotency-Key', 'correction').send({ ...reviewBody, decision: 'accepted', comment: 'Уточнённый балл.', reason: 'Исправлена оценка по критерию' }).expect(200);
    await request(server).post(`${path}/reviews/${correction.body.item.id}/publish`).set(teacherHeaders).set('If-Match', '0').set('Idempotency-Key', 'publish-correction').send({}).expect(200);
    const history = await request(server).get(`${path}/assignment-recipients/${recipientA.id}/submissions`).set(aHeaders).expect(200);
    expect(history.body.items[0].reviews).toHaveLength(2);
    await request(server).post(`${path}/assignments/${assignmentId}/close`).set(teacherHeaders).set('If-Match', '1').send({ reason: 'Период работы завершён' }).expect(200);
    await request(server).get(`${path}/assignments/${assignmentId}/recipients`).set(bHeaders).expect(200)
      .expect(({ body }) => expect(body.items[0].status).toBe('closed'));
    const materialFile = (await request(server).post(`${path}/files`).set(teacherHeaders).attach('file', Buffer.from('reference notes'), 'reference.txt').expect(200)).body.item;
    const materialBody = { programVersionId: version.id, title: 'Разбор механики', description: 'Опорный конспект', taskDefinitionIds: [task.id], fileId: materialFile.id };
    const material = await request(server).post(`${path}/materials`).set(teacherHeaders).set('Idempotency-Key', 'material-one').send(materialBody).expect(200);
    const materialId = material.body.item.id;
    await request(server).patch(`${path}/materials/${materialId}`).set(headers(adminToken, 'admin')).set('If-Match', '0')
      .send({ description: 'Уточнённый конспект', fileId: materialFile.id }).expect(200);
    await request(server).get(`${path}/materials/${materialId}`).set(aHeaders).expect(404);
    await request(server).get(`${path}/files/${materialFile.id}/download`).set(aHeaders).expect(404);
    await request(server).post(`${path}/materials/${materialId}/publish`).set(teacherHeaders).set('If-Match', '1').set('Idempotency-Key', 'material-publish')
      .send({ courseId: course.id, recipientEnrollmentIds: [a.id] }).expect(200);
    await request(server).get(`${path}/materials/${materialId}`).set(aHeaders).expect(200);
    await request(server).get(`${path}/materials/${materialId}`).set(bHeaders).expect(404);
    await request(server).get(`${path}/files/${materialFile.id}/download`).set(aHeaders).expect(200);
    const otherCourse = await prisma.course.create({ data: { workspaceId: workspace.id, programVersionId: version.id, title: 'Другой курс физики', defaultFormat: 'individual', capacity: 1, startsOn: today, timezone: 'UTC', status: 'active' } });
    await prisma.courseTeacher.create({ data: { workspaceId: workspace.id, courseId: otherCourse.id, membershipId: otherTeacherMember.id, role: 'lead', startsOn: today } });
    const otherEnrollment = await prisma.enrollment.create({ data: { workspaceId: workspace.id, courseId: otherCourse.id, membershipId: cMember.id, status: 'active', startsOn: today } });
    await request(server).post(`${path}/materials/${materialId}/publish`).set(headers(adminToken, 'admin')).set('If-Match', '2').set('Idempotency-Key', 'material-other-course')
      .send({ courseId: otherCourse.id, recipientEnrollmentIds: [otherEnrollment.id] }).expect(200);
    const materialDetail = await request(server).get(`${path}/materials/${materialId}`).set(teacherHeaders).expect(200);
    expect(materialDetail.body.item.publications).toHaveLength(1);
    expect(materialDetail.body.item.publications[0].courseId).toBe(course.id);
    expect(materialDetail.body.item.canEdit).toBe(false);
    expect(materialDetail.body.item.canArchive).toBe(true);
    await request(server).post(`${path}/materials/${materialId}/publications/${materialDetail.body.item.publications[0].id}/revoke`)
      .set(teacherHeaders).set('If-Match', '0').send({ reason: 'Обновлённая редакция материала' }).expect(200);
    const hiddenPublication = await prisma.materialPublication.findFirstOrThrow({ where: { materialId, courseId: otherCourse.id } });
    await request(server).post(`${path}/materials/${materialId}/publications/${hiddenPublication.id}/revoke`)
      .set(teacherHeaders).set('If-Match', '0').send({ reason: 'Чужой курс недоступен' }).expect(404);
    await request(server).get(`${path}/materials/${materialId}`).set(teacherHeaders).expect(200)
      .expect(({ body }) => { expect(body.item.publications).toHaveLength(1); expect(body.item.canEdit).toBe(false); });
    await request(server).get(`${path}/files/${materialFile.id}/download`).set(aHeaders).expect(404);
    await request(server).get(`${path}/materials/${materialId}`).set(cHeaders).expect(200);
    await request(server).post(`${path}/materials/${materialId}/archive`).set(teacherHeaders).set('If-Match', '4')
      .send({ reason: 'Материал заменён новой редакцией' }).expect(200);
    await request(server).get(`${path}/materials/${materialId}`).set(cHeaders).expect(404);
    await request(server).get(`${path}/files/${materialFile.id}/download`).set(cHeaders).expect(404);
    expect(await prisma.assignmentSubmission.count({ where: { recipientId: recipientA.id } })).toBe(2);
    expect(await prisma.assignmentReview.count({ where: { submissionId: secondId } })).toBe(2);
    expect(adminMember.workspaceId).toBe(workspace.id);
    expect(otherTeacherMember.workspaceId).toBe(workspace.id);
    expect(c.id).toBeTruthy();
  });
});
