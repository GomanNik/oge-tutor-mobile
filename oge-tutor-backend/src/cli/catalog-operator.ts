import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { validateEmail } from '../common/validation';

const prisma = new PrismaClient();

async function main() {
  const command = process.argv[2];
  if (command !== 'grant' && command !== 'revoke') throw new Error('Usage: catalog:operator -- grant|revoke (CATALOG_USER_EMAIL required)');
  const email = validateEmail(process.env.CATALOG_USER_EMAIL);
  const result = await prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { email } });
    if (!user) throw new Error('User not found. Create an account before assigning catalog access.');
    const current = await tx.catalogGrant.findUnique({ where: { userId: user.id } });
    if (command === 'grant' && current || command === 'revoke' && !current) return { id: user.id, changed: false };
    if (command === 'grant') await tx.catalogGrant.create({ data: { userId: user.id } });
    else await tx.catalogGrant.delete({ where: { userId: user.id } });
    await tx.catalogAuditEvent.create({ data: {
      actorKind: 'operator', targetType: 'catalog_grant', targetId: user.id,
      action: command === 'grant' ? 'catalog_grant.created' : 'catalog_grant.revoked',
      changes: { enabled: command === 'grant' }, requestId: randomUUID(),
    } });
    return { id: user.id, changed: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Catalog operator command failed.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
