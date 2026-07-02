import { describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { AccessTokenService } from '../src/auth/access-token.service';
import { AuthMailerService } from '../src/auth/auth-mailer.service';
import { AuthService } from '../src/auth/auth.service';
import { BootstrapService } from '../src/bootstrap/bootstrap.service';
import { FILE_SCOPE, HOMEWORK_REVIEW_ACTION, HOMEWORK_STATUS, MATERIAL_TYPE, ROLE } from '../src/common/contracts';
import { FilesService } from '../src/files/files.service';
import { HomeworksService } from '../src/homeworks/homeworks.service';
import { LessonsService } from '../src/lessons/lessons.service';
import { MaterialsService } from '../src/materials/materials.service';
import { StudentsService } from '../src/students/students.service';

function config(values: Record<string, string | undefined> = {}) {
  return { get: (key: string) => values[key] } as any;
}

function future(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function upload(name: string): Express.Multer.File {
  return {
    originalname: name,
    mimetype: 'application/pdf',
    size: 12,
    buffer: Buffer.from('test file'),
  } as Express.Multer.File;
}

class MemoryPrisma {
  users: any[] = [];
  teachers: any[] = [];
  students: any[] = [];
  accessTokens: any[] = [];
  files: any[] = [];
  materialTopics: any[] = [];
  materialAttachments: any[] = [];
  lessons: any[] = [];
  homeworks: any[] = [];
  submissions: any[] = [];
  progress: any[] = [];
  history: any[] = [];
  notifications: any[] = [];
  sequence = 1;

  next(prefix: string) {
    return `${prefix}-${this.sequence++}`;
  }

  withUser(profile: any) {
    return { ...profile, user: this.users.find((user) => user.id === profile.userId) };
  }

  withTeacher(profile: any) {
    return { ...profile, user: this.users.find((user) => user.id === profile.userId) };
  }

  withStudentIncludes(profile: any) {
    return {
      ...this.withUser(profile),
      teacher: this.teachers.find((teacher) => teacher.id === profile.teacherId),
      progress: this.progress.filter((item) => item.studentId === profile.id).map((item) => ({
        ...item,
        history: this.history.filter((event) => event.taskProgressId === item.id),
      })),
    };
  }

  user = {
    create: vi.fn(async ({ data }) => {
      const row = { id: this.next('u'), createdAt: new Date(), updatedAt: new Date(), ...data };
      this.users.push(row);
      return row;
    }),
    findUnique: vi.fn(async ({ where, include }) => {
      const row = this.users.find((user) => (where.id ? user.id === where.id : user.email === where.email));
      if (!row) return null;
      if (!include) return row;
      return {
        ...row,
        teacherProfile: this.teachers.find((teacher) => teacher.userId === row.id) || null,
        studentProfile: this.students.find((student) => student.userId === row.id) || null,
      };
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = this.users.find((user) => user.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
  };

  teacherProfile = {
    findUnique: vi.fn(async ({ where, include }) => {
      const row = this.teachers.find((teacher) => teacher.id === where.id || teacher.userId === where.userId);
      if (!row) return null;
      return include?.user ? this.withTeacher(row) : row;
    }),
    findUniqueOrThrow: vi.fn(async ({ where, include }) => {
      const row = await this.teacherProfile.findUnique({ where, include });
      if (!row) throw new Error('not found');
      return row;
    }),
  };

  studentProfile = {
    create: vi.fn(async ({ data }) => {
      const row = { id: this.next('s'), createdAt: new Date(), updatedAt: new Date(), note: '', ...data };
      this.students.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where, include, select }) => {
      const row = this.students.find((student) => (
        (!where.id || student.id === where.id)
        && (!where.userId || student.userId === where.userId)
        && (!where.teacherId || student.teacherId === where.teacherId)
      ));
      if (!row) return null;
      const mapped = include?.user || include?.teacher ? this.withStudentIncludes(row) : row;
      if (select) return Object.fromEntries(Object.keys(select).map((key) => [key, mapped[key]]));
      return mapped;
    }),
    findUnique: vi.fn(async ({ where, include }) => {
      const row = this.students.find((student) => student.id === where.id || student.userId === where.userId);
      if (!row) return null;
      return include ? this.withStudentIncludes(row) : row;
    }),
    findMany: vi.fn(async ({ where }) => this.students
      .filter((student) => !where?.teacherId || student.teacherId === where.teacherId)
      .map((student) => this.withStudentIncludes(student))),
    update: vi.fn(async ({ where, data }) => {
      const row = this.students.find((student) => student.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
  };

  accessToken = {
    create: vi.fn(async ({ data }) => {
      const row = { id: this.next('token'), createdAt: new Date(), usedAt: null, ...data };
      this.accessTokens.push(row);
      return row;
    }),
    findUnique: vi.fn(async ({ where, include }) => {
      const row = this.accessTokens.find((token) => token.tokenHash === where.tokenHash || token.id === where.id);
      if (!row) return null;
      if (!include?.user) return row;
      const user = await this.user.findUnique({ where: { id: row.userId }, include: { teacherProfile: true, studentProfile: true } });
      return { ...row, user };
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      const row = this.accessTokens.find((token) => token.id === where.id && token.usedAt === where.usedAt);
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
  };

  fileResource = {
    create: vi.fn(async ({ data }) => {
      const row = { uploadedAt: new Date(), scope: FILE_SCOPE.PRIVATE_UPLOAD, ...data };
      this.files.push(row);
      return row;
    }),
    findUnique: vi.fn(async ({ where }) => this.files.find((file) => file.id === where.id) || null),
    update: vi.fn(async ({ where, data }) => {
      const row = this.files.find((file) => file.id === where.id);
      Object.assign(row, data);
      return row;
    }),
  };

  materialTopic = {
    upsert: vi.fn(async ({ where, create, update }) => {
      let row = this.materialTopics.find((topic) => topic.teacherId === where.teacherId_taskNumber.teacherId && topic.taskNumber === where.teacherId_taskNumber.taskNumber);
      if (row) Object.assign(row, update, { updatedAt: new Date() });
      else {
        row = { id: this.next('topic'), createdAt: new Date(), updatedAt: new Date(), ...create };
        this.materialTopics.push(row);
      }
      return row;
    }),
    findMany: vi.fn(async ({ where, include }) => this.materialTopics
      .filter((topic) => (!where?.teacherId || topic.teacherId === where.teacherId)
        && (!where?.taskNumber?.in || where.taskNumber.in.includes(topic.taskNumber)))
      .map((topic) => ({
        ...topic,
        files: include?.files ? this.materialAttachments
          .filter((item) => item.topicId === topic.id)
          .map((item) => ({ ...item, file: this.files.find((file) => file.id === item.fileId) || null })) : [],
      }))),
  };

  materialAttachment = {
    create: vi.fn(async ({ data }) => {
      const row = { id: this.next('mat'), createdAt: new Date(), ...data };
      this.materialAttachments.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }) => this.materialAttachments.find((item) => {
      const topic = this.materialTopics.find((candidate) => candidate.id === item.topicId);
      return (!where.id || item.id === where.id)
        && (!where.topicId || item.topicId === where.topicId)
        && (!where.fileId || item.fileId === where.fileId)
        && (!where.topic || (
          topic?.teacherId === where.topic.teacherId
          && where.topic.taskNumber.in.includes(topic.taskNumber)
        ));
    }) || null),
    delete: vi.fn(async ({ where }) => {
      this.materialAttachments = this.materialAttachments.filter((item) => item.id !== where.id);
    }),
  };

  lesson = {
    findFirst: vi.fn(async ({ where }) => this.lessons.find((lesson) => (
      (!where.id || lesson.id === where.id)
      && (!where.teacherId || lesson.teacherId === where.teacherId)
      && (!where.studentId || lesson.studentId === where.studentId)
      && (!where.status?.in || where.status.in.includes(lesson.status))
    )) || null),
    findMany: vi.fn(async ({ where }) => this.lessons.filter((lesson) => (
      (!where?.teacherId || lesson.teacherId === where.teacherId)
      && (!where?.studentId || lesson.studentId === where.studentId)
    ))),
    create: vi.fn(async ({ data }) => {
      const row = { id: this.next('lesson'), createdAt: new Date(), updatedAt: new Date(), completedAt: null, completionComment: '', ...data };
      this.lessons.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = this.lessons.find((lesson) => lesson.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
  };

  homework = {
    findFirst: vi.fn(async ({ where }) => this.homeworks.find((homework) => (
      (!where.id || homework.id === where.id)
      && (!where.teacherId || homework.teacherId === where.teacherId)
      && (!where.studentId || homework.studentId === where.studentId)
    )) || null),
    findMany: vi.fn(async ({ where, include }) => this.homeworks
      .filter((homework) => (!where?.teacherId || homework.teacherId === where.teacherId)
        && (!where?.studentId || homework.studentId === where.studentId))
      .map((homework) => ({
        ...homework,
        attempts: include?.attempts ? this.submissions
          .filter((submission) => submission.homeworkId === homework.id)
          .map((submission) => ({ ...submission, fileResource: this.files.find((file) => file.id === submission.fileResourceId) })) : [],
      }))),
    create: vi.fn(async ({ data }) => {
      const row = { id: this.next('hw'), createdAt: new Date(), updatedAt: new Date(), assignedAt: new Date(), submittedAt: null, reviewedAt: null, closedAt: null, solutionFile: '', teacherComment: '', reviewMaterials: [], ...data };
      this.homeworks.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = this.homeworks.find((homework) => homework.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
  };

  homeworkSubmission = {
    create: vi.fn(async ({ data }) => {
      const row = { id: this.next('sub'), submittedAt: new Date(), reviewedAt: null, teacherComment: '', ...data };
      this.submissions.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }) => this.submissions.find((submission) => submission.homeworkId === where.homeworkId) || null),
    update: vi.fn(async ({ where, data }) => {
      const row = this.submissions.find((submission) => submission.id === where.id);
      Object.assign(row, data);
      return row;
    }),
  };

  studentTaskProgress = {
    findUnique: vi.fn(async ({ where }) => this.progress.find((item) => item.studentId === where.studentId_taskNumber.studentId && item.taskNumber === where.studentId_taskNumber.taskNumber) || null),
    upsert: vi.fn(async ({ where, create, update }) => {
      let row = this.progress.find((item) => item.studentId === where.studentId_taskNumber.studentId && item.taskNumber === where.studentId_taskNumber.taskNumber);
      if (row) Object.assign(row, update, { updatedAt: new Date() });
      else {
        row = { id: this.next('progress'), createdAt: new Date(), updatedAt: new Date(), lessonCount: 0, ...create };
        this.progress.push(row);
      }
      return row;
    }),
  };

  progressHistory = {
    create: vi.fn(async ({ data }) => {
      const row = { id: this.next('history'), createdAt: new Date(), ...data };
      this.history.push(row);
      return row;
    }),
  };

  notification = {
    create: vi.fn(async ({ data }) => {
      const row = { id: this.next('notice'), createdAt: new Date(), resolvedAt: null, ...data };
      this.notifications.push(row);
      return row;
    }),
    findMany: vi.fn(async ({ where }) => this.notifications.filter((notice) => (
      (!where?.teacherId || notice.teacherId === where.teacherId)
      && (!where?.studentId || notice.studentId === where.studentId)
    ))),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };

  $transaction = vi.fn(async (callback) => callback(this));
}

async function buildServices() {
  const prisma = new MemoryPrisma();
  const teacherPasswordHash = await bcrypt.hash('teacherpass', 4);
  const teacherUser = { id: 'u-teacher', email: 'teacher@mail.ru', role: ROLE.TEACHER, passwordHash: teacherPasswordHash, createdAt: new Date(), updatedAt: new Date() };
  prisma.users.push(teacherUser);
  prisma.teachers.push({ id: 't-1', userId: teacherUser.id, name: 'Teacher', avatar: '', bg: '', settings: {}, createdAt: new Date(), updatedAt: new Date() });

  const cfg = config({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret',
    FRONTEND_ORIGIN: 'http://localhost:5173',
    PUBLIC_BACKEND_URL: 'http://localhost:3000',
    UPLOAD_DIR: 'uploads/test-runtime',
  });
  const accessTokens = new AccessTokenService(prisma as any, cfg);
  const mailer = new AuthMailerService(cfg);
  const files = new FilesService(prisma as any, cfg);
  return {
    prisma,
    auth: new AuthService(prisma as any, { sign: vi.fn(() => 'jwt-token') } as any, cfg, accessTokens, mailer),
    bootstrap: new BootstrapService(prisma as any, cfg),
    students: new StudentsService(prisma as any, accessTokens, mailer),
    lessons: new LessonsService(prisma as any, files),
    homeworks: new HomeworksService(prisma as any, files),
    files,
    materials: new MaterialsService(prisma as any, files),
    accessTokens,
  };
}

describe('service-level fullstack flow', () => {
  it('covers auth, bootstrap, invite, lessons, homework, files and access isolation', async () => {
    const app = await buildServices();
    const teacherLogin = await app.auth.validateCredentials('teacher@mail.ru', 'teacherpass');
    const teacherSession = await app.auth.signSession(teacherLogin);
    expect(teacherSession).toMatchObject({ id: 't-1', role: ROLE.TEACHER, token: 'jwt-token' });
    await expect(app.bootstrap.buildForUser('u-teacher')).resolves.toMatchObject({ teacher: { id: 't-1' } });

    const teacher = { id: 'u-teacher', role: ROLE.TEACHER, teacherId: 't-1', email: 'teacher@mail.ru' };
    const created = await app.students.create(teacher, { email: 'student@mail.ru', name: 'Student', note: 'Teacher note' });
    const inviteToken = created.invite.preview?.token;
    expect(inviteToken).toBeTruthy();
    await app.accessTokens.complete(inviteToken, 'studentpass');

    const studentLogin = await app.auth.validateCredentials('student@mail.ru', 'studentpass');
    const studentSession = await app.auth.signSession(studentLogin);
    const student = { id: studentSession.userId, role: ROLE.STUDENT, studentId: studentSession.id, email: studentSession.email };
    await expect(app.bootstrap.buildForUser(studentSession.userId)).resolves.toMatchObject({ students: [expect.objectContaining({ note: 'Teacher note' })] });

    const materialFile = await app.files.saveUploadedFile(teacher, upload('material.pdf'), { context: 'material-library' });
    await app.materials.add(teacher, {
      taskNumber: 6,
      type: MATERIAL_TYPE.FILE,
      item: { title: 'Task 6 material', fileId: materialFile.id },
    });

    const lesson = await app.lessons.create(teacher, {
      studentId: student.studentId,
      topic: 'Task 6',
      startAt: future(60),
      endAt: future(120),
      focusTaskNumbers: [6],
      materials: [],
    });
    await app.lessons.complete(teacher, lesson.id, { focusTaskNumbers: [6], completionComment: 'Done' });

    const homework = await app.homeworks.create(teacher, {
      studentId: student.studentId,
      title: 'Homework',
      taskNumbers: [6],
      dueAt: future(240),
      materials: [],
    });
    await app.homeworks.submit(student, homework.id, upload('solution.pdf'), { fileTitle: 'solution.pdf' });
    expect(app.prisma.homeworks.find((item) => item.id === homework.id)?.status).toBe(HOMEWORK_STATUS.SUBMITTED);
    await app.homeworks.review(teacher, homework.id, { action: HOMEWORK_REVIEW_ACTION.APPROVE, comment: 'ok' });
    expect(app.prisma.history).toHaveLength(2);

    const submissionFile = app.prisma.files.find((item) => item.originalName === 'solution.pdf');
    await expect(app.files.requireDownloadableFile(student as any, submissionFile.id)).resolves.toMatchObject({ id: submissionFile.id });
    await expect(app.files.requireDownloadableFile(teacher as any, submissionFile.id)).resolves.toMatchObject({ id: submissionFile.id });
    await expect(app.files.requireDownloadableFile(student as any, materialFile.id)).resolves.toMatchObject({ id: materialFile.id });

    const foreignTeacherFile = { ...materialFile, id: 'f-foreign', ownerId: 'u-foreign-teacher' };
    app.prisma.files.push(foreignTeacherFile);
    await expect(app.files.requireDownloadableFile(student as any, foreignTeacherFile.id)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
