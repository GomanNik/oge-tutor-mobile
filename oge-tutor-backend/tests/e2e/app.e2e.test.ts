import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpErrorFilter } from '../../src/common/http-error.filter';
import { ACCESS_STATUS, ROLE } from '../../src/common/contracts';

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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
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
    const studentId = createdStudent.body.data.students[0].id;
    expect(inviteToken).toBeTruthy();

    await request(server)
      .post('/auth/access-token/complete')
      .send({ token: inviteToken, password: 'studentpass' })
      .expect(201)
      .expect(({ body }) => expect(body).toEqual({ ok: true }));

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

    const startAt = new Date(Date.now() + 60 * 60 * 1000);
    const endAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
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
    const lessonId = lessonCreated.body.data.lessons[0].id;

    await request(server)
      .get(`/files/${materialFileId}/download`)
      .set(auth(studentToken))
      .expect(200);

    await request(server)
      .post(`/lessons/${lessonId}/complete`)
      .set(auth(teacherToken))
      .send({ focusTaskNumbers: [6], completionComment: 'Done' })
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
    const homeworkId = homeworkCreated.body.data.homeworks[0].id;

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

    await request(server)
      .get(`/files/${foreignFile.id}/download`)
      .set(auth(studentToken))
      .expect(403);

    await request(server)
      .post(`/homeworks/${homeworkId}/review`)
      .set(auth(teacherToken))
      .send({ status: 'reviewed', comment: 'Accepted' })
      .expect(201);

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

    await request(server)
      .post('/auth/login')
      .send({ email: 'teacher-e2e@mail.ru', password: 'teacherpass2' })
      .expect(201);
  });
});
