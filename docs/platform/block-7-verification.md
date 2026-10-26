# Блок 7: проверка реализации

Дата: 2026-10-26. Ветка `codex/block7-series-cutover`, база принятого `main` `559944e`. Это отчёт реализации до принятия владельцем и слияния. Удалённые CI/SHA фиксируются в PR; наличие документа не заменяет успешный прогон.

## Среда и границы

Windows, Node.js 22, pnpm 9.15.9, PostgreSQL 16 в существующем тестовом Docker-контейнере на 5438. Используются только `oge_tutor_block7_e2e_test`, `oge_tutor_block7_browser_test` и сгенерированные `oge_accept_ci_*` / `oge_restore_ci_*`. Пользовательские учебные данные, рабочие контейнеры приложения, чужие запущенные сервисы и untracked `docs.zip` не изменяются. Docker Desktop был запущен для испытаний; другие автоматически поднятые контейнеры не останавливаются.

## Матрица

| Проверка | Доказательство |
|---|---|
| Календарь | `tests/series-recurrence.test.ts`: недельные/месячные правила, длительность, DST gap/fold, исключаемые даты, диапазоны и лимит раскрытия. |
| Режимы v1 | `tests/legacy-cutover.test.ts`: маршруты, режимы, config ACK, persisted marker и запрет конфигурационного отката. |
| Файлы/оператор | `tests/release-files.test.ts`: байты, SHA/размер, realpath root, отсутствующие checksum, отказ при повреждении/неверном режиме, baseline с manifest и требование замещающего приглашения. |
| Реальный PostgreSQL | AppModule E2E: серии, ключи/ревизии/preview, права, исключения/история, пауза/resume/cancel, rolling worker, конкурентные запросы и полный cutover. Все вызванные JSON ответы сверяются с OpenAPI. |
| Историческая БД | `test:migrations`: последовательное расширение старой схемы с заполненными данными, повторный deploy/backfill, прежний паритет, immutable события, новые FK/CHECK/уникальность серии, факт посещаемости импортированного курса и cutover marker. |
| Восстановление | `test:restore`: pg_dump/pg_restore и файлы, повреждённая копия отвергнута, восстановленный HTTP API и новая учебная запись с результатом. Только фикстура. |
| Браузер | Real API сценарии новых series/account/release экранов при 390/1365 px, затем отдельный запуск backend disabled и импортированный курс teacher/student. |
| UI-регрессия | Прежние real-API сценарии блоков 1–6, viewport/keyboard и unit (в том числе StrictMode для одноразовой ссылки). |
| Поставка | Production build, lint/typecheck, dependency audit, Docker build, Prisma validate/status/drift; полный CI на head PR. |

## Результаты

| Прогон | Результат |
|---|---|
| Общий quality | Backend build/lint, 111 unit; frontend build/lint/typecheck, 47 unit. |
| Финальный PostgreSQL AppModule E2E | 16/16, включая строгие ответы OpenAPI, worker после отзыва полномочий и отказ пароля >72 UTF-8 байта. |
| Real API браузер | 13/13, 4 параллельных workers; 2 cutover-теста намеренно пропущены до перезапуска API. |
| После disabled/restart | 2/2 на той же disposable-базе: перенесённый курс, создание урока teacher, видимость student, admin-сверка, отсутствие старого кабинета, v1 410. |
| Viewport/keyboard | 3/3. Новые экраны проверены также при 390 и 1365 px, горизонтальное переполнение отсутствует. |
| Миграции | 14 deploy-миграций, `test:migrations` на старой заполненной и новой БД, повтор и ограничения проходят. `prisma validate` и diff: дрейфа нет. |
| Restore | Итог `ok=true`, 2 проверенных файла, повреждённая копия отвергнута; все restored API флаги успешны. JSON в backend/test-results. |
| Operator | release verify для native пространства без файлов в read_only: exit 0; несуществующий workspace: exit 1, без изменений. Серийный worker проверен напрямую реальной БД в E2E. |
| Docker | Backend и frontend образы `block7-local` собираются. Работающие контейнеры приложения не обновлялись. |
| Backup shell | Все тесты проходят в Git Bash; flock на Windows замокан, настоящее межпроцессное удержание проверяет Linux CI. |
| Audit | Проходит с явно указанным известным dev advisory; предупреждение о JS чанке сохранено. |

Снимки series-preview/list, account, release-status, imported-course и retired-student сохраняются в раздельных папках Playwright real-api/cutover; новые экраны просмотрены визуально. Это временные артефакты, не пользовательские данные.

Промежуточные исправления не скрываются: строгая сверка OpenAPI выявила отсутствовавшие поля аудита экземпляров серии, схема дополнена и полный E2E повторно прошёл. Браузерный точный label для select заменён на доступную роль combobox. Дополнительный локальный прогон до готовности перезапущенного API не считается приёмкой; итоговый полный прогон выполнен с health-предусловием и чистой фикстурой. Ужесточён nullable CHECK идентичности экземпляра и сверка отсутствующего преподавателя урока. На Windows generate нельзя запускать одновременно с процессом, удерживающим DLL клиента. Отсутствие VITE_API_BASE_URL при production build является ожидаемым отказом конфигурации.

Первый head `0e949a7` прошёл удалённый CI [40264678481](https://github.com/GomanNik/oge-tutor-mobile/actions/runs/40264678481): 7/7. Финальный просмотр добавил единый порядок блокировки аккаунта до токена при password reset; полный локальный backend build/lint, 111 unit и 16 E2E повторно проходят. Новый PostgreSQL сценарий использует две reset-ссылки параллельно и получает ровно `[200,409]`. Итоговый CI и точный head после этого усиления фиксируются в [PR #12](https://github.com/GomanNik/oge-tutor-mobile/pull/12); успех предыдущего head не подменяет проверку нового. После принятия владельцем требуется CI уже объединённого main; сам этот отчёт не выполняет merge.

## Воспроизведение

```powershell
pnpm install --frozen-lockfile
pnpm run quality
pnpm --dir oge-tutor-backend run test:e2e
pnpm --dir oge-tutor-backend run test:migrations
pnpm --dir oge-tutor-backend run test:restore
pnpm --dir oge-tutor-app exec playwright test --grep 'real API'
```

Нужны настроенные DATABASE_URL/E2E_DATABASE_URL одноразовой среды, VITE_API_BASE_URL для сборки, browser credentials из CI и RELEASE_POSTGRES_CONTAINER для drill. Для второго браузерного этапа тот же backend перезапускается в disabled с ACK и `CUTOVER_REAL_API=true`, затем `playwright test --grep 'cutover real API'`. Нельзя менять этот флаг при ещё работающем enabled backend и считать тестом переключения.

## Неподтверждённое

- Не выполнен production rollout; нет VPS и активированного на нём backup timer.
- Нет подтверждения фактической SMTP-доставки в почтовый ящик.
- Нет внешнего независимого ревью и утверждённых численных SLO на больших пользовательских объёмах.
- Drill синтетический; пользовательский backup отдельно проверяется перед реальным переключением.
- Физический DROP v1 не выполняется до периода наблюдения и отдельного согласия, см. ADR в runbook.
- Известное dev-tooling advisory `GHSA-vfj7-8cjw-p6xm` без upstream patch и предупреждение Vite о JS чанке >500 kB не выдаются за устранённые.
