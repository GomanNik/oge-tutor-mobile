import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpErrorFilter } from '../../src/common/http-error.filter';
import { ACCESS_STATUS, ROLE } from '../../src/common/contracts';
import { createValidationPipe } from '../../src/common/validation-pipe';
import { createApiDocument } from '../../src/swagger/api-document';

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
    process.env.UPLOAD_DIR = uploadDir;

    const { AppModule } = await import('../../src/app.module');
    const { PrismaService } = await import('../../src/prisma/prisma.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
    server = app.getHttpServer();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Notification", "ProgressHistory", "StudentTaskProgress", "MaterialAttachment", "MaterialTopic", "HomeworkSubmission", "Homework", "Lesson", "FileResource", "AccessToken", "StudentProfile", "TeacherProfile", "User" RESTART IDENTITY CASCADE');

    await prisma.user.create({
      data: {
        email: 'teacher-e2e@mail.ru',
        role: ROLE.TEACHER,
        passwordHash: await bcrypt.hash('teacherpass', 4),
        teacherProfile: {
          create: {
            name: 'E2E Teacher',
            settings: {},
          },
        },
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    if (uploadDir) fs.rmSync(uploadDir, { recursive: true, force: true });
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
        expect(success?.[1].content, `${method.toUpperCase()} ${route} has no response schema`).toBeDefined();
        if (method === 'post' || method === 'patch') {
          if (route !== '/auth/logout' && route !== '/notifications/read-all') {
            expect(operation.requestBody, `${method.toUpperCase()} ${route} has no request schema`).toBeDefined();
          }
        }
      }
    }
    expect(operations).toBeGreaterThanOrEqual(45);
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
    const otherStudentUser = await prisma.user.create({
      data: {
        email: 'other-student@mail.ru',
        role: ROLE.STUDENT,
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
    });
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
});
