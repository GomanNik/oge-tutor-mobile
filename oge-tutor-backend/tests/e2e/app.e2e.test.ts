import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpErrorFilter } from '../../src/common/http-error.filter';
import { ACCESS_STATUS, ROLE } from '../../src/common/contracts';
import { createValidationPipe } from '../../src/common/validation-pipe';
import { createApiDocument } from '../../src/swagger/api-document';
import { ensureLegacyStudent, ensureLegacyTeacher } from '../../src/workspace/legacy';
import { AuthMailerService } from '../../src/auth/auth-mailer.service';

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
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Workspace", "Notification", "ProgressHistory", "StudentTaskProgress", "MaterialAttachment", "MaterialTopic", "HomeworkSubmission", "Homework", "Lesson", "FileResource", "AccessToken", "StudentProfile", "TeacherProfile", "User" RESTART IDENTITY CASCADE');

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
    const update = document.paths['/api/v2/workspaces/{workspaceId}/members/{memberId}'].patch;
    expect(update?.responses).toHaveProperty('412');
    expect(update?.responses).toHaveProperty('428');
    expect(update?.parameters?.some(parameter => !('$ref' in parameter) && parameter.name === 'If-Match' && parameter.required)).toBe(true);
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
});
