/*
 * OGE Tutor App — repository quality gate.
 * It combines dependency checks, import checks, prototype-pattern checks and domain smoke tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const mode = process.argv[2] || 'lint';

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return full;
    });
}

function sourceFiles() {
    return walk(SRC).filter((file) => /\.(js|jsx)$/.test(file));
}

function runtimeSourceFiles() {
    return sourceFiles().filter((file) => !file.includes(`${path.sep}src${path.sep}data${path.sep}`));
}

function fail(messages) {
    if (messages.length) {
        console.error(messages.map((message) => `- ${message}`).join('\n'));
        process.exit(1);
    }
}

function assertNoLatestDeps() {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const sections = ['dependencies', 'devDependencies'];

    return sections.flatMap((section) => Object.entries(pkg[section] || {})
        .filter(([, version]) => version === 'latest')
        .map(([name]) => `${section}.${name} uses "latest"`));
}

function assertRelativeImportsExist() {
    const errors = [];
    const importRe = /from\s+['"](\.\.?\/[^'"]+)['"]|import\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;

    sourceFiles().forEach((file) => {
        const text = fs.readFileSync(file, 'utf8');

        for (const match of text.matchAll(importRe)) {
            const spec = match[1] || match[2];
            const resolved = path.resolve(path.dirname(file), spec);
            const candidates = [
                resolved,
                `${resolved}.js`,
                `${resolved}.jsx`,
                path.join(resolved, 'index.js'),
                path.join(resolved, 'index.jsx'),
            ];

            if (!candidates.some((candidate) => fs.existsSync(candidate))) {
                errors.push(`${path.relative(ROOT, file)} imports missing ${spec}`);
            }
        }
    });

    return errors;
}

function assertNoRuntimeLegacyImports() {
    const errors = [];

    runtimeSourceFiles().forEach((file) => {
        const rel = path.relative(ROOT, file);
        const text = fs.readFileSync(file, 'utf8');

        if (/from\s+['"][^'"]*data\/initialData\.js['"]/.test(text)) errors.push(`${rel}: imports legacy initialData`);
        if (/from\s+['"][^'"]*services\/storage\.js['"]/.test(text)) errors.push(`${rel}: imports legacy storage`);
        if (/from\s+['"][^'"]*services\/importers\.js['"]/.test(text)) errors.push(`${rel}: imports removed importers service`);
        if (/from\s+['"][^'"]*app\/actions\.js['"]/.test(text)) errors.push(`${rel}: imports legacy actions`);
    });

    return errors;
}

function assertNoApiDomainProgressCycle() {
    const errors = [];
    const dto = fs.readFileSync(path.join(SRC, 'api', 'dto.js'), 'utf8');
    const progressContracts = fs.readFileSync(path.join(SRC, 'domain', 'progress', 'progressContracts.js'), 'utf8');

    if (/domain\/progress\/index\.js/.test(dto)) errors.push('src/api/dto.js must not import domain progress index');
    if (/api\/contracts\.js/.test(progressContracts)) errors.push('progress contracts must not import api contracts');

    return errors;
}

function assertUploadFirstAttachmentFlow() {
    const http = fs.readFileSync(path.join(SRC, 'api', 'httpClient.js'), 'utf8');
    const errors = [];

    if (!/request\('\/files'/.test(http)) errors.push('httpClient must upload files via POST /files before attaching them');
    if (!/resolvePayloadAttachments/.test(http)) errors.push('httpClient must resolve embedded attachment files before JSON mutations');
    if (/pending-\$\{Date\.now\(\)\}/.test(http)) errors.push('httpClient must not invent fallback file ids when backend upload response is invalid');

    return errors;
}

function assertNoKnownPrototypePatterns() {
    const patterns = [
        { re: /taskNumber:\s*['"]4['"]/, message: 'hardcoded taskNumber: 4' },
        { re: /topics\[0\]/, message: 'fallback to first material topic' },
        { re: /buildFileMaterial\([^,)]*\)/, message: 'file material can be created without File' },
        { re: /VITE_API_BASE_URL[^\n]+\?[^\n]+mock/i, message: 'mock selected implicitly from missing API URL' },
    ];

    const errors = [];

    sourceFiles().forEach((file) => {
        const rel = path.relative(ROOT, file);
        const text = fs.readFileSync(file, 'utf8');

        patterns.forEach(({ re, message }) => {
            if (re.test(text)) errors.push(`${rel}: ${message}`);
        });
    });

    return errors;
}

async function runSmokeTests() {
    const { parseTaskNumbers, parseTaskNumberInput } = await import(pathToFileURL(path.join(SRC, 'shared/formatters.js')).href);
    const { buildLessonSchedule, minutesBetween } = await import(pathToFileURL(path.join(SRC, 'shared/dateTime.js')).href);
    const { validateEmail } = await import(pathToFileURL(path.join(SRC, 'shared/validation.js')).href);
    const { markTasksAssessmentNeeded, PROGRESS_MASTERY_LEVEL } = await import(pathToFileURL(path.join(SRC, 'domain/progress/index.js')).href);

    const errors = [];

    const parsed = parseTaskNumbers('1, 2, 2, 25, 26, bad');
    if (parsed.join(',') !== '1,2,25') {
        errors.push('parseTaskNumbers must keep unique known OGE task numbers only');
    }

    const detailed = parseTaskNumberInput('1, 1, 26, x');
    if (!detailed.duplicates.includes(1) || !detailed.outOfRange.includes(26) || !detailed.invalidTokens.includes('x')) {
        errors.push('parseTaskNumberInput must report duplicates/out-of-range/invalid tokens');
    }

    const schedule = buildLessonSchedule({
        date: '2026-05-15',
        time: '18:00',
        durationMinutes: 60,
        timezone: 'Europe/Moscow',
    });

    if (!schedule.startAt || !schedule.endAt || minutesBetween(schedule.startAt, schedule.endAt, 0) !== 60) {
        errors.push('buildLessonSchedule must produce a valid 60-minute interval');
    }

    if (validateEmail('bad@').ok || !validateEmail('student@example.com').ok) {
        errors.push('validateEmail must reject incomplete addresses and accept valid addresses');
    }

    const assessedAgain = markTasksAssessmentNeeded(
        [{ taskNumber: 6, coverageStatus: 'assessed', masteryLevel: PROGRESS_MASTERY_LEVEL.MEDIUM }],
        [6],
        { id: 'l-test', completedAt: '2026-05-15T10:00:00.000Z' },
        'Повторили',
    );

    const taskSix = assessedAgain.find((item) => item.taskNumber === 6);

    if (taskSix.masteryLevel !== null || taskSix.lastAssessedMasteryLevel !== PROGRESS_MASTERY_LEVEL.MEDIUM) {
        errors.push('markTasksAssessmentNeeded must preserve previous mastery in lastAssessedMasteryLevel');
    }

    return errors;
}

const common = [
    ...assertNoLatestDeps(),
    ...assertRelativeImportsExist(),
    ...assertNoRuntimeLegacyImports(),
    ...assertNoApiDomainProgressCycle(),
    ...assertUploadFirstAttachmentFlow(),
];

if (mode === 'lint') fail([...common, ...assertNoKnownPrototypePatterns()]);
else if (mode === 'typecheck') fail(common);
else if (mode === 'test') fail(await runSmokeTests());
else fail([`Unknown quality-check mode: ${mode}`]);

console.log(`quality-check ${mode}: ok`);