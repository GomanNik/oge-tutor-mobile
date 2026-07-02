import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppError, conflict } from '../common/app-error';
import { ROLE } from '../common/contracts';
import { cleanText, requireText, validateEmail, validatePassword } from '../common/validation';

type BootstrapTeacherInput = {
  email: string;
  password: string;
  name: string;
};

const prisma = new PrismaClient();

function parseArgs(argv: string[]) {
  const values: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

    const rawArg = arg.slice(2);
    const equalsIndex = rawArg.indexOf('=');
    const rawKey = equalsIndex >= 0 ? rawArg.slice(0, equalsIndex) : rawArg;
    const inlineValue = equalsIndex >= 0 ? rawArg.slice(equalsIndex + 1) : undefined;
    const key = rawKey.trim();
    const nextValue = argv[index + 1];
    const value = inlineValue ?? (nextValue && !nextValue.startsWith('--') ? nextValue : '');
    values[key] = value;
    if (inlineValue === undefined && value) index += 1;
  }

  return values;
}

function readInput(): BootstrapTeacherInput {
  const args = parseArgs(process.argv.slice(2));
  const email = validateEmail(args.email || process.env.BOOTSTRAP_TEACHER_EMAIL);
  const password = validatePassword(args.password || process.env.BOOTSTRAP_TEACHER_PASSWORD);
  const name = requireText(args.name || process.env.BOOTSTRAP_TEACHER_NAME || 'Преподаватель', 'name');

  return { email, password, name };
}

async function createInitialTeacher(input: BootstrapTeacherInput) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return prisma.$transaction(async (tx) => {
    const teacherCount = await tx.teacherProfile.count();
    if (teacherCount > 0) {
      throw conflict('Первый преподаватель уже создан. Bootstrap-команда больше не применима.');
    }

    const existingUser = await tx.user.findUnique({ where: { email: input.email } });
    if (existingUser) {
      throw conflict('Пользователь с таким email уже существует.', { email: 'exists' });
    }

    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        role: ROLE.TEACHER,
      },
    });

    return tx.teacherProfile.create({
      data: {
        userId: user.id,
        name: input.name,
        avatar: '',
        bg: '',
        settings: {},
      },
      include: { user: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function formatFieldErrors(error: AppError) {
  const entries = Object.entries(error.fieldErrors);
  if (!entries.length) return '';
  return ` (${entries.map(([field, code]) => `${field}: ${code}`).join(', ')})`;
}

async function main() {
  const input = readInput();
  const teacher = await createInitialTeacher(input);
  console.log(`Initial teacher created: ${cleanText(teacher.name)} <${teacher.user.email}>`);
}

main()
  .catch((error: unknown) => {
    if (error instanceof AppError) {
      console.error(`${error.message}${formatFieldErrors(error)}`);
      process.exitCode = error.status >= 500 ? 1 : 2;
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      console.error('Bootstrap conflict. Повторите команду, если первый преподаватель ещё не создан.');
      process.exitCode = 2;
      return;
    }

    if (error instanceof Error) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    console.error('Не удалось создать первого преподавателя.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
