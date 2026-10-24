# Блок 1. Пространства, идентичность и управление участниками

Статус: **реализация блока 1 объединена в `main` по решению владельца с открытыми проверками; промышленный rollout не выполнен**. Версия: 2026-10-24. Фактические результаты и оставшиеся условия перед развёртыванием указаны в [отчёте](block-1-verification.md). Термины и долгосрочные правила заданы в [индексе](README.md), [домене](domain.md), [архитектуре](architecture.md) и [политике доступа](access.md).

## 1. Цель и результат блока

Сделать работающий вертикальный срез идентичности: один аккаунт может быть администратором, преподавателем и/или учеником в нескольких независимых рабочих пространствах; администратор управляет участниками **своего** пространства; вход, приглашение, отзыв доступа и переключение контекста работают через реальный PostgreSQL и интерфейс. Старые кабинеты и данные продолжают работать до следующих блоков.

Готовый результат демонстрируется без фиктивного каталога или курсов: администратор входит, видит участников, приглашает нового или существующего пользователя, назначает/отзывает роли, приостанавливает/возобновляет членство и видит аудит. Приглашённый подтверждает вход, получает только разрешённый контекст. Пользователь с двумя пространствами и несколькими ролями переключает их без повторного входа и без смешивания данных.

### Границы

**Входит:** расширение БД, безопасный backfill существующих пользователей, v2-аутентификация, контекстная авторизация, workspace membership/role grants, приглашения по email, администраторский список/деталь/управление участниками, локальное имя участника, журнал административных действий, минимальные кабинеты и выбор контекста, совместимость v1, OpenAPI и тесты.

**Не входит:** предметы и версии программ (блок 2); курсы, преподаватели курса, зачисления и отвязка `StudentProfile.teacherId` (блок 3); группы/уроки (блок 4); работы/файлы (блок 5); прогресс/уведомления (блок 6); периодические занятия и эксплуатационное завершение v1 (блок 7). Отдельный глобальный администратор каталога, массовый импорт, SSO, смена email, саморегистрация, публичное создание пространств и физическое удаление пользователя/пространства здесь не реализуются. Настройка бэкапов на VPS невозможна до появления VPS и не является критерием этого PR.

В блоке 1 роль `student` означает право войти в ученический контекст, **не** автоматическое зачисление или доступ к учебным данным. Для нового ученика без старой привязки `StudentProfile` пока не создаётся: существующая модель требует `teacherId`. Аналогично новая роль `teacher` не даёт доступа к чужим старым записям. Эти связи появятся в блоке 3. UI честно показывает пустое состояние, а не подставляет демонстрационные данные.

## 2. Исходная модель и решения совместимости

Сейчас [схема Prisma](../../oge-tutor-backend/prisma/schema.prisma) содержит обязательный `User.role ∈ {teacher,student}` и обязательный `StudentProfile.teacherId`. [JWT strategy](../../oge-tutor-backend/src/auth/jwt.strategy.ts) проверяет студенческий доступ глобально, [RoleGuard](../../oge-tutor-backend/src/common/role.guard.ts) доверяет одной роли, [v1 login](../../oge-tutor-backend/src/auth/auth.controller.ts) сразу загружает полный кабинет, [App.jsx](../../oge-tutor-app/src/app/App.jsx) знает лишь два экрана. Нельзя просто добавить `admin` в enum и считать задачу решённой.

1. `User.role` остаётся nullable **только как `legacyRole`-смысл** для v1; имя колонки не меняется в этом блоке. Для старых пользователей значение сохраняется. Для нового admin-only и новых аккаунтов значение `null`; v2 никогда не использует его для полномочий. `AuthUser.role` на v1 пути становится nullable, и каждый v1 endpoint требует совместимый legacy-профиль. Нельзя выдавать синтетическую `teacher`-роль администратору.
2. Новый v2 вход создаёт обычную `AuthSession`, проверяет пароль и сессию, но не требует `TeacherProfile`/`StudentProfile`. JWT хранит `sub` и `sid`, не набор прав. v1 login и формат старого ответа сохраняются для аккаунтов с действительным legacy-профилем; admin-only и новые пользователи пользуются v2. Смена пароля и logout отзывают сессии по существующей логике.
3. Стратегия JWT устанавливает только идентичность. Проверка `StudentProfile.access`, наличия legacy-профиля и активного исторического членства переносится на **все защищённые v1 маршруты**. Это важно: отключённый у старого преподавателя ученик должен сохранить доступ к другим пространствам v2, но не к старому кабинету. Проверить маршруты без `@Roles`, а не полагаться на текущий `RoleGuard`.
4. Старые `TeacherProfile` и `StudentProfile` не удаляются, их ID и связи остаются прежними. Старое создание ученика одновременно создаёт membership/роль в пространстве преподавателя; старое отключение/включение ученика согласует состояние этого membership. v2 приостановка исторического членства блокирует соответствующий v1 путь. Эти переходы атомарны и покрыты тестами; длительную двойную запись учебного домена не вводим.
5. Один и тот же пользователь может иметь несколько v2 ролей. Если есть старый `role`, он определяет **только** старый кабинет; назначение дополнительных ролей не переписывает его. Новый `User.displayName` — имя собственного аккаунта; `WorkspaceMembership.displayNameOverride` — локальная подпись, которую может менять администратор. Изменение локальной подписи не меняет имя в других пространствах. Старое редактирование имени ученика синхронизирует лишь локальную подпись исторического пространства.

## 3. Данные и инварианты

Ниже утверждённая логическая схема блока. Точные имена Prisma-полей можно привести к стилю репозитория, но ограничения и смысл менять нельзя без обновления документа. Все ID — существующий формат Prisma, время — UTC, email нормализуется тем же правилом, что при входе.

| Таблица/поле | Содержание и ограничения |
|---|---|
| `User.displayName`, `User.role?`, `User.revision` | Общее имя, nullable старое значение роли и ревизия профиля для `If-Match`. Уникальный нормализованный email, `passwordHash`, `sessionVersion` сохраняются. Для пустого имени старого профиля нужен отчёт, не выдуманный человек. |
| `Workspace` | `id`, `name`, `slug` (уникален, не используется для прав), `timezone` (IANA), `status=active/archived`, `revision`, `createdAt`, `updatedAt`. `archived` закрывает изменения и v1 доступ; штатная архивация пока только операторская процедура после проверки зависимостей. |
| `WorkspaceMembership` | `id`, `workspaceId`, `userId`, `status=active/suspended`, `displayNameOverride?`, `revision`, `joinedAt`, `suspendedAt?`, `createdAt`, `updatedAt`; уникально `(workspaceId,userId)`. Не удалять при блокировке. |
| `WorkspaceRoleGrant` | `id`, `membershipId`, `role=admin/teacher/student`, `grantedAt`, `grantedById?`, `revokedAt?`, `revokedById?`; уникально `(membershipId,role)`. Повторное назначение активирует прежнюю строку с новым временем; каждое изменение отдельно в аудите. |
| `WorkspaceInvitation` | `id`, `workspaceId`, нормализованный `email`, хеш случайного токена, `status=pending/accepted/revoked/expired`, `expiresAt`, `acceptedAt?`, `revokedAt?`, `inviterUserId`, `createdAt`, `revision`, `deliveryStatus`; роли — отдельные `WorkspaceInvitationRole`, не свободный JSON. Не более одного `pending` на `(workspaceId,email)`; просроченное приглашение переводится в `expired` перед новой отправкой. Повторная отправка ротирует токен и срок. |
| `WorkspaceAuditEvent` | `id`, `workspaceId`, `actorUserId?`/`actorKind`, `targetType`, `targetId`, `action`, безопасные `before/after`, `reason?`, `requestId`, `occurredAt`. Только вставка в приложении, без публичного изменения/удаления. |
| `WorkspaceEmailOutbox` | `id`, тип письма, ссылка на приглашение, зашифрованный краткоживущий payload доставки, `attempts`, `nextAttemptAt`, `sentAt?`, `lastErrorCode?`. Рабочий процесс обрабатывает повторы; сырой токен удаляется после доставки или истечения срока. Шифрование ключом окружения, исключённым из логов/бэкапа исходников. |
| `IdempotencyRecord` | Ключ, `actorUserId`, маршрут, hash канонического тела, hash/сериализованный безопасный ответ, `expiresAt`; уникальность `(actorUserId,route,key)`. Очистка после минимальных 24 часов; не хранить секреты приглашений. |
| `LegacyWorkspaceMapping` | Стойкое соответствие `teacherProfileId -> workspaceId`; уникально с обеих сторон. Не выводить пространство из текущего email/имени. Сохраняется до полного удаления v1. |

Внешние ключи для ролей, приглашений и аудита используют ограничительную стратегию удаления (`Restrict`/сохранение истории), не каскадное стирание людей и событий. Для уникальности `pending` приглашения, которую Prisma не умеет выразить условием, использовать SQL partial index и проверять его интеграционно. Списки индексируются по `(workspaceId,status,id)`, приглашения по `(workspaceId,email,status)`, аудит по `(workspaceId,occurredAt,id)`; фактический запрос/план сверяется до приёмки. Токен генерируется криптографическим генератором (не менее 256 бит), хешируется для поиска/проверки, срок действия по умолчанию 72 часа, повторное использование отклоняется. Сырой токен живёт лишь в ссылке доставки и защищённом краткоживущем outbox до отправки, не в открытом виде в основных таблицах, ответе API или логе.

**Инварианты:** membership относится ровно к одному `User` и `Workspace`; назначение роли возможно только члену этого пространства; хотя бы один **активный** администратор остаётся в активном пространстве; нельзя приостановить последнего администратора или отозвать его роль; администратор не меняет глобальный email/пароль другого пользователя; приостановка членства сразу отнимает все права в этом пространстве, не отзывает доступ к другим. Проверка последнего администратора выполняется транзакционно с блокировкой строки `Workspace` при конкурирующих изменениях, а не предварительным `count` вне транзакции. `revision` увеличивается при каждом изменении членства/пространства.

### Перенос старых данных

Для каждого существующего `TeacherProfile` создаётся **отдельное** пространство и `LegacyWorkspaceMapping`; это сохраняет текущую границу видимости. Его `User` получает членство с `admin+teacher`. Каждый `StudentProfile` получает `student`-членство в пространстве своего `teacherId`, даже если пока `invite_sent`/`disabled`; фактический вход по v1 дополнительно проверяет `StudentProfile.access`. При `disabled` членство приостанавливается; при незавершённом приглашении оно активно как запись, но реальный вход невозможен до установки пароля. Имя и email не используются для автоматического склеивания различных `User`. Все существующие ID сессий/учебных записей сохраняются.

Backfill идемпотентен и ведёт отчёт `teachers/users/memberships/grants/ambiguous/orphaned`. Если встречены профиль без пользователя, студент без преподавателя, дублирующийся mapping или несовместимое значение доступа, выполнение останавливается без частичного продолжения конкретной партии и даёт идентификаторы для разбирательства. На пустой БД оператор запускает новую CLI-команду и создаёт первое пространство и admin-аккаунт через одноразовый секрет из безопасного ввода/переменной окружения, без пароля по умолчанию и без печати секрета. Последующие пространства в блоке 1 создаёт операторская CLI-команда по явному запросу; публичного `POST /workspaces` нет. Это осознанная граница между администратором пространства и оператором платформы.

Схема внедряется expand-only: сначала новые nullable поля `displayName`/`role` и `revision` с default, затем backfill имён и связей, после сверки — `NOT NULL` для `displayName`. Старые колонки, FK и записи не удаляются. Если применение остановилось после расширения, старый backend продолжает работать; если после backfill — повторяем операцию по стойкому mapping. Для возврата приложения используется прежний образ backend при сохранённой расширенной схеме, **не** destructive down-migration; данные откатываются только из заранее проверенного restore point по отдельному решению. На тестовой копии до миграции проверяются backup и restore БД; запуск на рабочей БД допускается только после сверки и restore point. Из-за отсутствия VPS эту процедуру пока можно подтвердить локально/в CI, а промышленное развертывание не объявлять завершённым.

## 4. Права и состояния

Каждый `/api/v2/workspaces/:workspaceId/...` запрос требует Bearer-сессию и `X-Active-Role: admin|teacher|student`. Backend ищет активное членство именно в `workspaceId`, активный grant выбранной роли и capability операции. Заголовок не является доказательством права; значение без grant даёт `403`. Отсутствующий заголовок — `400 missing_context`. Чтение `/me` и собственных пространств заголовка не требует. Клиент хранит выбранные `workspaceId+role` лишь как UI-контекст, не как авторизационный токен. Для списков фильтрация выполняется в SQL до пагинации; для детали и мутации чужой `workspaceId`/ID возвращает `404`, чтобы не раскрывать объект.

| Операция | admin | teacher | student |
|---|---|---|---|
| Список/деталь всех участников и приглашений пространства | да, минимум нужных полей | нет в блоке 1 | нет |
| Создать/повторить/отозвать приглашение | да | нет | нет |
| Назначить/отозвать роль, приостановить/возобновить членство | да, кроме последнего admin | нет | нет |
| Менять локальное отображаемое имя участника | да | нет | нет |
| Читать административный аудит | да | нет | нет |
| Читать собственные пространства/роли и менять свой displayName | да, для себя | да, для себя | да, для себя |
| Читать существующие учебные данные v1 | только при отдельном действующем legacy-профиле и доступе | аналогично | аналогично |

В этом блоке capability зафиксированы кодом: `members.read`, `members.manage`, `invites.manage`, `audit.read`, `workspace.read`; их нельзя произвольно выдать через клиентский DTO. `admin` не получает доступ к приватной заметке преподавателя и старым учебным записям лишь из-за админства. Старый v1 путь дополнительно проверяет активность исторического membership/пространства и старый профиль. Смена роли или приостановка действует на следующем запросе; JWT не содержит закешированных полномочий. Сессию глобально не отзываем при локальном снятии роли, иначе сломаем другие пространства. Старые уже открытые страницы должны обработать `403`, сбросить контекст и перечитать `/me/workspaces`.

Приглашение: `pending -> accepted | revoked | expired`. Принятие нового email создаёт `User` (после проверки пароля) и membership+grants атомарно; существующий User входит в свой аккаунт и принимает ссылку при точном совпадении нормализованного email. Если его membership уже активно, добавляются только новые роли; если оно приостановлено, приём отклоняется до отдельного административного `resume`. Нельзя передать email в accept-body и привязать другой аккаунт. Повторное принятие не создаёт дубликат и возвращает безопасный `409 invitation_used` для обоих путей. Повторная отправка инвалидирует старый токен и отменяет неотправленные письма с ним; отзыв делает то же самое. Worker перед отправкой заново проверяет статус и ревизию приглашения. Ошибка отправки письма оставляет приглашение в `deliveryStatus=failed`, допускает retry и не раскрывает ссылку произвольному HTTP-клиенту. Лимиты частоты, длины полей и числа приглашений в одном пространстве обязательны.

Членство: `active <-> suspended`; история ролей хранится даже после отзыва. Участник с нулём активных ролей не получает workspace-контекст, но запись и аудит остаются. Восстановление membership само по себе не восстанавливает отозванные роли. Для старого ученика v1 `disabled` и v2 `suspended` согласуются адаптером только в его историческом пространстве; старое `invite_sent/password_pending` не превращается автоматически в `active` при возобновлении. Для старого преподавателя приостановка собственного исторического membership также закрывает его v1 кабинет.

## 5. Контракты HTTP блока 1

Маршруты ниже **новые** под `/api/v2`. В отличие от v1, ни одна мутация не возвращает полный bootstrap. Ответ детали `{item}`, списка `{items,pageInfo:{nextCursor,hasMore}}`, мутации `{item,changed,requestId}`. Списки используют opaque cursor, `limit` по умолчанию 25 и максимум 100, стабильный порядок по `createdAt,id` (аудит — обратный). DTO строго отклоняют неизвестные поля; email нормализуется, UUID/CUID валидируется по фактическому формату. В OpenAPI у каждого маршрута описаны тело, ответ, ошибки, Bearer и `X-Active-Role`. Ошибка использует действующую форму `{code,message,fieldErrors?,requestId}` без токенов/чужих данных.

| Метод и путь | Вход; ответ | Право/заметки |
|---|---|---|
| `POST /auth/login` | `{email,password}`; `{session:{token,userId,expiresAt},user,contexts}` | Публичный, rate limit; без bootstrap. Неверные учётные данные и неизвестный email дают одинаковую ошибку. |
| `POST /auth/logout` | `{}`; `204` | Текущая сессия; прежний v1 logout остаётся. |
| `GET /me` | `{item:{id,email,displayName}}` | Владелец аккаунта. |
| `PATCH /me` | `{displayName}` + `If-Match`; `{item,changed,requestId}` | Владелец; email/пароль не меняются этим маршрутом. |
| `GET /me/workspaces` | `{items:[{workspaceId,name,status,roles}],...}` | Только активные membership/grants, без чужих участников. |
| `GET /workspaces/:w` | `{item:{id,name,timezone,status,revision}}` | Активный участник; без чувствительных настроек. |
| `GET /workspaces/:w/members?cursor&limit&status&role&q` | Страница минимальных карточек `{id,userId,displayName,email,roles,status,revision}` | `members.read`; `q` — ограниченный поиск по имени/email в данном пространстве. |
| `GET /workspaces/:w/members/:id` | Одна карточка участника | `members.read`; чужой ID — `404`. |
| `PATCH /workspaces/:w/members/:id` | `{displayNameOverride}` + `If-Match`; мутация | `members.manage`; `null` снимает локальный override, глобальный User не меняется. |
| `POST /workspaces/:w/members/:id/roles` | `{role,reason?}` + `Idempotency-Key`; мутация | `members.manage`; повторная активная роль не плодит строк. |
| `POST /workspaces/:w/members/:id/roles/:role/revoke` | `{reason}` + `If-Match`; мутация | `members.manage`; последний admin защищён. |
| `POST /workspaces/:w/members/:id/suspend` / `resume` | `{reason}` + `If-Match`; мутация | `members.manage`; последний admin защищён; `resume` не возвращает роли. |
| `GET /workspaces/:w/invitations?cursor&limit&status` | Список без токена, с маскированным/ограниченным email | `invites.manage`. |
| `POST /workspaces/:w/invitations` | `{email,roles:[...],expiresInHours?}` + `Idempotency-Key`; `{item:{id,email,roles,expiresAt,deliveryStatus}}` | `invites.manage`; отправка после фиксации/через outbox, без сырого токена в ответе. |
| `POST /workspaces/:w/invitations/:id/resend` / `revoke` | `{reason?}` + `If-Match`; мутация | `invites.manage`; resend меняет токен, revoke немедленно его инвалидирует. |
| `POST /invitations/accept-new` | `{token,displayName,password}`; `{session,contexts}` | Публичный, rate limit; только если email ещё не принадлежит User. |
| `POST /invitations/accept-existing` | `{token}`; `{item:membership}` | Авторизованный User, email обязан совпасть с приглашением. |
| `GET /workspaces/:w/audit-events?cursor&limit&action&targetId&from&to` | Страница безопасных событий | `audit.read`; фильтры/лимиты обязательны. |

`Idempotency-Key` scoped к актору, маршруту и телу; срок хранения минимум 24 часа; тот же ключ с другим телом — `409 idempotency_conflict`. Для приёма приглашения атомарное потребление токена уже обеспечивает защиту от повторов. `If-Match` содержит ревизию сущности; отсутствие — `428 precondition_required`, несовпадение — `412 revision_mismatch`. Для `POST` state transition `If-Match` относится к membership/invitation. `400` — DTO/контекст, `401` — вход, `403` — нет активной роли, `404` — чужой/отсутствующий ресурс, `409` — состояние/последний admin/дубликат, `422` — доменное ограничение, `429` — rate limit. `requestId` во всех ошибках. `GET /api/docs` показывает точные схемы v1 и v2 раздельными тегами.

Валидация входа: `displayName` после trim — 2–100 символов, имя пространства — 2–120, локальное имя — `null` либо 2–100, `reason` — 10–500, поисковая строка — 1–100, email — не более 254 и нормализован существующим валидатором, `roles` — 1–3 разных значения из enum, `expiresInHours` — 24–168 (по умолчанию 72), `limit` — 1–100. Пароль проходит **существующую** политику `validatePassword`, без второго набора правил. `q` не передаётся в сырое SQL и не ищет вне выбранного пространства. Неверный cursor даёт `400`, cursor другого фильтра/пространства не используется. Изменение timezone здесь не открыто через HTTP; CLI проверяет IANA-зону. Содержимое `reason` не допускает HTML-исполнения в UI и не попадает в незамаскированные общие логи.

## 6. Сигнатуры use case и границы модулей

Следующие сигнатуры — **контракт проектирования**, не уже написанный код. Возвращаемые DTO не включают `passwordHash`, хеш/сырой токен, чужие membership и приватные учебные поля. Репозитории/Prisma и mailer внедряются через существующие Nest-модули; все проверки в сервисе повторяются после проверки контроллера. `Actor` берётся из серверной сессии, не из тела запроса.

```ts
type WorkspaceRole = 'admin' | 'teacher' | 'student';
type MembershipStatus = 'active' | 'suspended';
type Capability = 'workspace.read' | 'members.read' | 'members.manage'
  | 'invites.manage' | 'audit.read';
type Actor = { userId: string; sessionId: string; requestId: string };
type WorkspaceContext = {
  actor: Actor; workspaceId: string; activeRole: WorkspaceRole;
  membershipId: string; capabilities: ReadonlySet<Capability>;
};
type PageInput = { cursor?: string; limit: number };
type Page<T> = { items: T[]; pageInfo: { nextCursor: string | null; hasMore: boolean } };
type Versioned = { revision: number };
type Mutation<T> = { item: T; changed: string[]; requestId: string };
type MyWorkspaceDto = { workspaceId: string; name: string; status: 'active'; roles: WorkspaceRole[];
  legacyRole: 'teacher' | 'student' | null };
type MeDto = { id: string; email: string; displayName: string; revision: number };
type SessionDto = { token: string; userId: string; expiresAt: string };
type LoginResultDto = { session: SessionDto; user: MeDto; contexts: MyWorkspaceDto[] };
type MemberDto = Versioned & {
  id: string; userId: string; displayName: string; email: string;
  roles: WorkspaceRole[]; status: MembershipStatus;
};
type MembershipDto = MemberDto;
type InvitationDto = Versioned & {
  id: string; email: string; roles: WorkspaceRole[]; expiresAt: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  deliveryStatus: 'queued' | 'sent' | 'failed';
};
type AuditScalar = string | number | boolean | null | WorkspaceRole[];
type AuditEventDto = {
  id: string; actorUserId: string | null; action: string;
  targetType: string; targetId: string; reason: string | null;
  changes: Record<string, AuditScalar>; requestId: string; occurredAt: string;
};
type MemberQuery = { status?: MembershipStatus; role?: WorkspaceRole; q?: string };
type InvitationQuery = { status?: InvitationDto['status'] };
type AuditQuery = { action?: string; targetId?: string; from?: string; to?: string };
type AuditWrite = Omit<AuditEventDto, 'id' | 'occurredAt'> & { workspaceId: string };
type LegacyActorContext = { userId: string; role: 'teacher' | 'student';
  teacherId: string; studentId?: string; workspaceId: string };
type BackfillReport = { teachers: number; users: number; memberships: number;
  grants: number; ambiguous: string[]; orphaned: string[] };
type BootstrapWorkspaceInput = { email: string; displayName: string;
  password: string; workspaceName: string; timezone: string };
type OperatorWorkspaceInput = { adminUserId: string; workspaceName: string;
  timezone: string; reason: string };
type WorkspaceDto = Versioned & { id: string; name: string;
  timezone: string; status: 'active' | 'archived' };

interface WorkspaceContextService {
  listMyContexts(actor: Actor): Promise<MyWorkspaceDto[]>;
  resolve(actor: Actor, workspaceId: string, activeRole: WorkspaceRole): Promise<WorkspaceContext>;
  require(ctx: WorkspaceContext, capability: Capability): void;
  requireLegacyAccess(actor: Actor): Promise<LegacyActorContext>;
}

interface WorkspaceBootstrapService {
  backfillLegacyUsers(): Promise<BackfillReport>;
  bootstrapFirstWorkspace(input: BootstrapWorkspaceInput): Promise<WorkspaceDto>;
  createWorkspaceByOperator(input: OperatorWorkspaceInput): Promise<WorkspaceDto>;
}

interface WorkspaceMembersService {
  list(ctx: WorkspaceContext, query: MemberQuery & PageInput): Promise<Page<MemberDto>>;
  get(ctx: WorkspaceContext, memberId: string): Promise<MemberDto>;
  updateLocalName(ctx: WorkspaceContext, memberId: string,
    input: { displayNameOverride: string | null; expectedRevision: number }): Promise<Mutation<MemberDto>>;
  grantRole(ctx: WorkspaceContext, memberId: string,
    input: { role: WorkspaceRole; reason?: string; idempotencyKey: string }): Promise<Mutation<MemberDto>>;
  revokeRole(ctx: WorkspaceContext, memberId: string,
    input: { role: WorkspaceRole; reason: string; expectedRevision: number }): Promise<Mutation<MemberDto>>;
  suspend(ctx: WorkspaceContext, memberId: string,
    input: { reason: string; expectedRevision: number }): Promise<Mutation<MemberDto>>;
  resume(ctx: WorkspaceContext, memberId: string,
    input: { reason: string; expectedRevision: number }): Promise<Mutation<MemberDto>>;
}

interface WorkspaceInvitationsService {
  list(ctx: WorkspaceContext, query: InvitationQuery & PageInput): Promise<Page<InvitationDto>>;
  create(ctx: WorkspaceContext, input: {
    email: string; roles: WorkspaceRole[]; expiresInHours?: number; idempotencyKey: string;
  }): Promise<Mutation<InvitationDto>>;
  resend(ctx: WorkspaceContext, invitationId: string,
    input: { expectedRevision: number }): Promise<Mutation<InvitationDto>>;
  revoke(ctx: WorkspaceContext, invitationId: string,
    input: { expectedRevision: number; reason?: string }): Promise<Mutation<InvitationDto>>;
  acceptNew(input: { token: string; displayName: string; password: string },
    requestId: string): Promise<LoginResultDto>;
  acceptExisting(actor: Actor, input: { token: string }): Promise<MembershipDto>;
}

interface WorkspaceAuditService {
  list(ctx: WorkspaceContext, query: AuditQuery & PageInput): Promise<Page<AuditEventDto>>;
  recordInTransaction(tx: Prisma.TransactionClient, event: AuditWrite): Promise<void>;
}

interface AuthV2Service {
  login(input: { email: string; password: string }, requestId: string): Promise<LoginResultDto>;
  logout(actor: Actor): Promise<void>;
  getMe(actor: Actor): Promise<MeDto>;
  updateMe(actor: Actor, input: { displayName: string; expectedRevision: number }): Promise<Mutation<MeDto>>;
}
```

`MemberQuery`, `InvitationQuery`, `AuditQuery` и остальные DTO должны быть именованными строгими типами с class-validator и OpenAPI-декораторами; `any`, произвольный `Json` и неограниченный `string[]` в публичном контракте запрещены. `Prisma.TransactionClient` используется только внутри backend. Запись изменения membership/grants и аудит — **одна транзакция**; приглашение, роли и outbox-запись — одна транзакция, отправка письма — после commit с повторяемой доставкой. Транзакция принятия приглашения проверяет токен и уникальности повторно под блокировкой/условным UPDATE. Эффект сетевого письма не откатывает уже зафиксированный account; неуспешная доставка видна админу и повторяется.

## 7. Интерфейс и клиент

После v2 входа приложение загружает `/me/workspaces`, выбирает последний допустимый контекст либо просит выбрать его; выбор сохраняется только локально и перепроверяется сервером. Переключатель пространства и роли доступен во всех кабинетах. Новый `AdminApp` содержит участников (поиск, фильтр, пагинация), приглашения (создать, повторить, отозвать), деталь участника (роль, локальное имя, приостановка с подтверждением и причиной) и журнал аудита. Для `teacher`/`student` без курсов — честное пустое состояние, без доступа к admin-данным. Существующие TeacherApp/StudentApp продолжают работать **только** при выборе соответствующего исторического пространства и legacy-роли; для новых пространств данные v1 не подмешиваются. Переключение пространства сбрасывает ресурсы/запросы предыдущего контекста и не показывает их во время загрузки следующего.

Предлагаемый клиентский контракт: `loginV2(credentials): Promise<LoginResultDto>`, `loadMyContexts(): Promise<MyWorkspaceDto[]>`, `selectContext({workspaceId,role}): void`, `listMembers(context,query): Promise<Page<MemberDto>>`, `inviteMember(context,input): Promise<InvitationDto>`, `updateMember(context,id,command): Promise<MemberDto>`, `acceptInvitation(token,mode,credentials?): Promise<LoginResultDto|MembershipDto>`. Методы `useBackendStore` для v1 не должны молча получать новый формат ответа. Контекст в заголовке ставится централизованно HTTP-клиентом, а не вручную в каждом компоненте. На `401` очищается сессия; на `403` контекст перечитывается, данные прежнего пространства немедленно скрываются. Административные команды показывают pending/success/error, не допускают двойной отправки и работают с клавиатуры и на мобильной ширине. Токен приглашения не сохраняется в `localStorage` и удаляется из URL после чтения.

Mock-режим либо имеет согласованные фикстуры admin/multi-role для unit UI-тестов, либо явно не предлагает v2 сценарий; выпуск не принимается, пока **реальный API** не покрывает те же пользовательские шаги. В UI нет кнопок операций будущих блоков, создающих иллюзию работающего курса/предмета.

## 8. Тесты и проверяемые сценарии

Тесты ниже обязательны в PR. Unit-тесты проверяют чистые политики/переходы; интеграционные и e2e используют PostgreSQL, а не in-memory замену для транзакций/индексов. Фикстура: пространство A с admin A, teacher A и student A; пространство B с admin B и тем же User в другой роли; отдельный admin-only; существующий legacy teacher/student; приглашение нового email. Время и случайность в тестах контролируются инъекцией часов/генератора.

| ID | Уровень | Проверка |
|---|---|---|
| B1-M01 | migration/PostgreSQL | Пустая БД: `migrate deploy`, bootstrap первого admin; повтор bootstrap не создаёт второй аккаунт/пространство. |
| B1-M02 | migration/PostgreSQL | Копия старой БД: каждому teacher — своё пространство; ученики попадают по `teacherId`; ID, хеши паролей, сессии и учебные строки неизменны. |
| B1-M03 | migration/PostgreSQL | Повторный backfill даёт ноль новых записей; частичный сбой можно безопасно повторить; сиротский/неоднозначный профиль даёт отчёт и останавливает применение. |
| B1-M04 | migration/PostgreSQL | Уникальность `(workspaceId,userId)`, `(membershipId,role)`, активного приглашения; FK и запрет каскадной потери аудита. |
| B1-A01 | auth/e2e | v2 login admin-only без TeacherProfile/StudentProfile, logout, истёкшая/отозванная сессия, неверный пароль и неизвестный email без различимого ответа. |
| B1-A02 | auth/e2e | Старый teacher/student входят через v1 и получают прежний контракт; admin-only и новый student без legacy-профиля не получают v1 кабинет. |
| B1-A03 | auth/e2e | Блокировка student в A не мешает v2 доступу в B; v1 кабинет A закрывается. Приостановка старого teacher закрывает его v1 кабинет (предварительно назначен другой admin, чтобы не нарушить last-admin). |
| B1-P01 | policy/e2e | Каждая list/detail/mutation/invitation/audit точка с чужим `workspaceId`/`memberId`/`invitationId`; нет чужих строк, `404` для чужой детали. |
| B1-P02 | policy/e2e | Роли admin+teacher, teacher+student, две роли в одном пространстве и разные роли в двух; подмена/отсутствие `X-Active-Role` не повышает права. |
| B1-P03 | policy/e2e | Отзыв роли и suspension отнимают право на **следующем** запросе, без разрыва доступа к независимому пространству; старые JWT не дают прежних полномочий. |
| B1-P04 | concurrency/PostgreSQL | Два одновременных запроса снять/заблокировать двух последних администраторов: ровно один проходит, один получает `409 last_admin`. То же для самоблокировки. |
| B1-I01 | invitations/e2e | Новый email: доставка, создание пользователя только при принятии, ровно одно membership и нужные grants, успешный вход. |
| B1-I02 | invitations/e2e | Существующий пользователь B принимает приглашение A без второго User; аккаунт с другим email получает отказ, без изменения членства. |
| B1-I03 | invitations/e2e | Истёкший, отозванный, повторно использованный и старый после resend токен отклоняются; токен не обнаруживается в БД открытым текстом, API/логах/аудите. |
| B1-I04 | concurrency/PostgreSQL | Два одновременных accept создают не более одного membership; две одинаковые отправки с одним idempotency key дают один результат, с другим телом — `409`. |
| B1-I05 | integration | Ошибка mailer помечает `failed`, retry меняет состояние; внешнему API сырой токен не возвращается. Rate limit работает по IP/цели. |
| B1-I06 | integration | Сбой процесса после commit не теряет письмо; worker повторяет доставку, не отправляет отменённый/старый токен, удаляет защищённый payload после доставки или истечения. |
| B1-I07 | invitations/e2e | Приглашение уже активного участника добавляет роль без дублирования membership; приостановленного участника не возобновляет автоматически. |
| B1-U01 | members/e2e | Админ меняет локальное имя/роль/статус только в A; global User и подпись B не меняются; аудит содержит actor, target, reason, requestId. |
| B1-U02 | members/e2e | `If-Match` обязателен, устаревшая ревизия даёт `412`; grant не дублируется; resume не возвращает отозванную роль. |
| B1-U03 | legacy/e2e | v1 создание и отключение/включение ученика согласуют membership; пароль/приглашение v1 по-прежнему работают; нет расширения доступа к чужому teacher. |
| B1-C01 | contract/OpenAPI | DTO rejects extra fields; все v2 ответы/ошибки соответствуют опубликованным схемам и не содержат hash/token/private note. |
| B1-F01 | frontend | Login admin, список/фильтр/страница, приглашение, grant/revoke/suspend, аудит; loading/empty/error и подтверждение опасного действия. |
| B1-F02 | frontend | Переключение A/B и admin/student: старые ресурсы исчезают до нового ответа; при `403` и logout кеш/контекст очищаются; прямая ссылка на чужую запись не раскрывает её. |
| B1-F03 | frontend | Доступность клавиатуры, фокус/подписи, мобильная ширина, отсутствие горизонтального переполнения и видимых токенов в URL после принятия. |
| B1-R01 | regression | Существующие backend/frontend unit и e2e, миграции, Docker build, сценарии v1 учителя/ученика и `pnpm run quality` проходят. |
| B1-N01 | performance/PostgreSQL | Синтетическое пространство с 10 000 участниками и 100 000 audit events: первая/средняя/последняя страницы корректны, запросы не загружают весь набор, число SQL-запросов на страницу ограничено константой; `EXPLAIN` использует ожидаемые индексы. Время и окружение измерены и приложены к PR, без непереносимого жёсткого SLA локального ПК. |
| B1-N02 | operations | Логи содержат `requestId`, маршрут и безопасный код ошибки; метрики считают отказы входа/прав, backlog и ошибки outbox; токены, пароли и полный email в общих логах отсутствуют. Задокументированы retry/cleanup outbox и idempotency records. |

Точечные тесты выполняются по мере реализации соответствующих модулей. Перед merge — полный `pnpm run quality`, `pnpm run backend:test:e2e` на реальной PostgreSQL, Prisma migration check, Docker build и вся CI. Дополнительно вручную пройти B1-F01/F02 на реальном API с двумя браузерными сессиями; зафиксировать версии, URL тестового окружения и результат в PR. Падающий тест нельзя помечать «известным» без решения владельца продукта.

## 9. План одного PR и критерии приёмки

1. **Подготовка:** снять базовые метрики/снимки v1 ответов и подтверждённый restore на тестовой копии; согласовать отправку писем и секрет bootstrap. При отсутствии подходящей копии реальных данных использовать обезличенную репрезентативную фикстуру и прямо указать ограничение.
2. **Коммит схемы:** expand migration, ограничения/индексы, backfill/CLI, тесты M01–M04. Не включать v2 UI до проверки миграции.
3. **Коммит auth/policy:** v2 login, `/me`, контекст, v1 bridge, тесты A/P и регрессия старых маршрутов.
4. **Коммит people/admin API:** приглашения, членство, роли, аудит, идемпотентность/ревизии, строгий OpenAPI, тесты I/U/C.
5. **Коммит клиента:** выбор контекста, AdminApp, приглашение, запросы и ошибки, тесты F. Сохранить работоспособность старых кабинетов.
6. **Граница PR:** полная CI/e2e/ручная проверка, проверка миграции пустой и старой БД, security review разрешений, скриншоты основных мобильного/десктопного сценариев, обновлённые docs/API и явный rollback.

PR принимается только если все B1 тесты зелёные, демо выполняется через реальный API, чужое пространство не видно ни через список, ни через прямой ID, у каждого активного пространства остаётся admin, старые кабинеты работают, миграция повторяема и не теряет записи, а OpenAPI совпадает с действующим HTTP. Невыполненный пункт блокирует merge либо переносится в **отдельный явно названный блок** с подтверждённой безопасной границей, не скрывается под формулировкой «почти готово». Промышленный rollout требует отдельного решения после restore и появления инфраструктуры; merge PR не равен включению на VPS.

### Что требуется подтвердить до кода

- Период жизни приглашения 72 часа и политика повторной отправки; доступность исходящей почты в тестовом окружении.
- Кто операторски создаёт дополнительные пространства; по умолчанию только CLI с контролируемым доступом, без публичной саморегистрации.
- Разрешено ли администратору видеть полный email всех участников своего пространства; по умолчанию да для приглашений/поддержки, журнал аудита маскирует его.
- Название/часовой пояс первого пространства и имя администратора при чистой установке; секрет не передавать в чат/PR.

Эти решения не блокируют написание спецификации. Если владелец продукта выберет иное, перед реализацией синхронно обновляются этот документ, [домен](domain.md), [доступ](access.md) и [план перехода](migration-and-acceptance.md).
