/*
 * OGE Tutor App — teacher materials library screens.
 * Materials have a real detail/edit flow: open/download, replace, rename, retag, delete and usage.
 */
import React, { useMemo, useState } from 'react';
import {
  buildFileMaterialFromFile,
  buildLinkMaterial,
  formatMaterialCount,
  isProbablyUrl,
  materialActionLabel,
  materialDisplayTitle,
  materialIcon,
  materialKindLabel,
  materialSourceText,
  normalizeText,
} from '../shared/formatters.js';
import { Button, Card, EmptyState, Field, Header, RowCard, Section, SelectField, cx } from '../shared/ui.jsx';
import { getMaterialUsage } from '../domain/productSelectors.js';
import { validateTaskNumbersInput } from '../shared/validation.js';

function findTopic(data, topicId) {
  return data.materials.find((topic) => topic.id === topicId) || null;
}

function findFile(topic, fileId) {
  return (topic?.files || []).find((file) => file.id === fileId) || null;
}

function taskOptions() {
  return Array.from({ length: 25 }, (_, index) => {
    const value = String(index + 1);
    return { value, label: `Задание ${value}` };
  });
}

function openUrl(url) {
  if (!url || typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function MaterialsList({ data, actions, openUpload, openLesson, openHomework, openStudent }) {
  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const selectedTopic = findTopic(data, selectedTopicId);

  if (selectedTopic) {
    return (
      <MaterialTopicDetail
        data={data}
        topic={selectedTopic}
        actions={actions}
        onBack={() => setSelectedTopicId(null)}
        openLesson={openLesson}
        openHomework={openHomework}
        openStudent={openStudent}
      />
    );
  }

  return (
    <>
      <Header title="Материалы" subtitle="Библиотека по заданиям ОГЭ, файлам и ссылкам" />
      <Button onClick={() => openUpload()}>Загрузить материал</Button>
      <Section title="Темы" />
      {data.materials.length ? data.materials.map((topic) => (
        <RowCard
          key={topic.id}
          icon={topic.taskNumber}
          iconTone="blue"
          title={topic.title}
          subtitle={formatMaterialCount(topic.files.length)}
          onClick={() => setSelectedTopicId(topic.id)}
        />
      )) : (
        <EmptyState
          title="Материалов пока нет"
          text="Добавьте файл или ссылку по номеру задания. После привязки к уроку или ДЗ здесь появится использование."
          action="Загрузить материал"
          onAction={() => openUpload()}
        />
      )}
    </>
  );
}

function MaterialTopicDetail({ data, topic, actions, onBack, openLesson, openHomework, openStudent }) {
  const [selectedFileId, setSelectedFileId] = useState(null);
  const selectedFile = findFile(topic, selectedFileId);

  if (selectedFile) {
    return (
      <MaterialFileDetail
        data={data}
        topic={topic}
        file={selectedFile}
        actions={actions}
        onBack={() => setSelectedFileId(null)}
        openLesson={openLesson}
        openHomework={openHomework}
        openStudent={openStudent}
      />
    );
  }

  return (
    <>
      <Header title={topic.title} subtitle={`Задание ${topic.taskNumber} · ${formatMaterialCount(topic.files.length)}`} onBack={onBack} />
      {topic.files.length ? topic.files.map((file) => (
        <RowCard
          key={file.id || materialDisplayTitle(file)}
          icon={materialIcon(file.type)}
          iconTone={file.type === 'link' ? 'violet' : 'blue'}
          title={materialDisplayTitle(file)}
          subtitle={`${materialKindLabel(file)} · ${materialSourceText({ ...file, taskNumber: topic.taskNumber, topicTitle: topic.title })}`}
          badge={materialActionLabel(file)}
          badgeTone="blue"
          onClick={() => setSelectedFileId(file.id)}
        />
      )) : (
        <EmptyState title="В теме нет материалов" text="Тема останется пустой, пока вы не добавите новый файл или ссылку." />
      )}
    </>
  );
}

function MaterialFileDetail({ data, topic, file, actions, onBack, openLesson, openHomework, openStudent }) {
  const [mode, setMode] = useState('view');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [replacementFile, setReplacementFile] = useState(null);
  const [form, setForm] = useState({
    title: materialDisplayTitle(file),
    taskNumber: String(topic.taskNumber || ''),
    topicTitle: topic.title || '',
    url: file.url || '',
    fileName: file.fileName || file.originalName || materialDisplayTitle(file),
  });
  const usage = useMemo(() => getMaterialUsage(data, topic, file), [data, topic, file]);

  async function removeFile() {
    try {
      setError('');
      setIsSaving(true);
      await actions.removeMaterialFile(topic.id, file.id);
      onBack();
    } catch (err) {
      setError(err?.message || 'Не удалось удалить материал.');
    } finally {
      setIsSaving(false);
    }
  }

  async function saveEdit() {
    const taskValidation = validateTaskNumbersInput(form.taskNumber, { required: true });
    const taskNumber = taskValidation.taskNumbers[0];
    const title = normalizeText(form.title);
    const topicTitle = normalizeText(form.topicTitle);

    if (!taskValidation.ok || taskValidation.taskNumbers.length !== 1) {
      setError(taskValidation.error || 'Укажите один номер задания от 1 до 25.');
      return;
    }
    if (!title) {
      setError('Укажите название материала.');
      return;
    }
    if (file.type === 'link' && !isProbablyUrl(form.url)) {
      setError('Проверьте ссылку: нужен адрес сайта.');
      return;
    }

    try {
      setError('');
      setIsSaving(true);
      await actions.updateMaterialFile(topic.id, file.id, {
        title,
        taskNumber,
        topicTitle,
        type: file.type,
        url: form.url,
      });
      setMode('view');
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить материал.');
    } finally {
      setIsSaving(false);
    }
  }

  async function saveReplacement() {
    if (!replacementFile) {
      setError('Выберите новый файл.');
      return;
    }

    try {
      setError('');
      setIsSaving(true);
      await actions.updateMaterialFile(topic.id, file.id, {
        title: normalizeText(form.fileName || replacementFile.name),
        taskNumber: Number(form.taskNumber),
        topicTitle: normalizeText(form.topicTitle),
        type: 'file',
        file: replacementFile,
        fileName: normalizeText(form.fileName || replacementFile.name),
      });
      setMode('view');
      setReplacementFile(null);
    } catch (err) {
      setError(err?.message || 'Не удалось заменить файл.');
    } finally {
      setIsSaving(false);
    }
  }

  function openUsage(item) {
    if (item.kind === 'lesson') openLesson?.(item.id);
    if (item.kind === 'homework') openHomework?.(item.id);
    if (item.kind === 'student') openStudent?.(item.id);
  }

  if (mode === 'edit') {
    return (
      <>
        <Header title="Редактировать материал" subtitle={materialDisplayTitle(file)} onBack={() => setMode('view')} />
        <Card className="form-stack">
          {error ? <div className="inline-error">{error}</div> : null}
          <Field label="Название материала" value={form.title} onChange={(title) => setForm({ ...form, title })} />
          <SelectField label="Номер задания" value={form.taskNumber} onChange={(taskNumber) => setForm({ ...form, taskNumber })} options={taskOptions()} />
          <Field label="Название темы" value={form.topicTitle} onChange={(topicTitle) => setForm({ ...form, topicTitle })} />
          {file.type === 'link' ? <Field label="Ссылка" value={form.url} onChange={(url) => setForm({ ...form, url })} /> : null}
          <Button onClick={saveEdit} disabled={isSaving}>{isSaving ? 'Сохраняем…' : 'Сохранить материал'}</Button>
        </Card>
      </>
    );
  }

  if (mode === 'replace') {
    return (
      <>
        <Header title="Заменить файл" subtitle={materialDisplayTitle(file)} onBack={() => setMode('view')} />
        <Card className="form-stack">
          {error ? <div className="inline-error">{error}</div> : null}
          <label className="file-drop-zone">
            <input type="file" onChange={(event) => {
              const nextFile = event.target.files?.[0] || null;
              setReplacementFile(nextFile);
              setForm({ ...form, fileName: nextFile?.name || form.fileName });
            }} />
            <span className="file-drop-icon" aria-hidden="true">↓</span>
            <strong>{replacementFile?.name || 'Выбрать новый файл'}</strong>
            <span>Новый файл загрузится через API и заменит текущий материал.</span>
          </label>
          <Field label="Название файла" value={form.fileName} onChange={(fileName) => setForm({ ...form, fileName })} />
          <Button onClick={saveReplacement} disabled={!replacementFile || isSaving}>{isSaving ? 'Заменяем…' : 'Заменить файл'}</Button>
        </Card>
      </>
    );
  }

  return (
    <>
      <Header title={materialDisplayTitle(file)} subtitle={`Задание ${topic.taskNumber} · ${materialKindLabel(file)}`} onBack={onBack} />
      <Card className="form-stack">
        {error ? <div className="inline-error">{error}</div> : null}
        <div className={cx('material-detail-icon', file.type === 'link' ? 'soft-violet' : 'soft-blue')}>{materialIcon(file.type)}</div>
        <div>
          <strong>{materialDisplayTitle(file)}</strong>
          <p className="subtitle">{materialSourceText({ ...file, taskNumber: topic.taskNumber, topicTitle: topic.title })}</p>
          {file.originalName ? <p className="subtitle">Файл: {file.originalName}</p> : null}
        </div>
        {file.url ? <Button onClick={() => openUrl(file.url)}>{materialActionLabel(file)}</Button> : null}
      </Card>

      <Section title="Где используется" />
      {usage.length ? usage.map((item) => (
        <RowCard
          key={`${item.kind}-${item.id}-${item.label}`}
          icon={item.kind === 'lesson' ? '□' : '✓'}
          iconTone={item.kind === 'lesson' ? 'blue' : 'amber'}
          title={item.title}
          subtitle={item.label}
          onClick={() => openUsage(item)}
        />
      )) : <EmptyState title="Материал ещё не используется" text="Прикрепите его к уроку или ДЗ через выбор материалов." />}

      <Section title="Действия" />
      <div className="btn-grid-2">
        <Button variant="soft" onClick={() => setMode('edit')} disabled={isSaving}>Редактировать</Button>
        <Button variant="soft" onClick={() => setMode('replace')} disabled={isSaving || file.type === 'link'}>Заменить файл</Button>
        <Button variant="danger" onClick={removeFile} disabled={isSaving}>Удалить</Button>
      </div>
    </>
  );
}

export function UploadMaterial({ actions, context = {}, onBack }) {
  const [form, setForm] = useState({ title: context.topicTitle || '', taskNumber: context.taskNumber ? String(context.taskNumber) : '', fileName: '', file: null, link: '' });
  const [mode, setMode] = useState('file');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    const taskValidation = validateTaskNumbersInput(form.taskNumber, { required: true });
    const taskNumber = taskValidation.taskNumbers[0];
    const cleanTopicTitle = normalizeText(form.title);
    const cleanFileName = normalizeText(form.fileName);
    const cleanLink = normalizeText(form.link);

    if (!taskValidation.ok || taskValidation.taskNumbers.length !== 1) {
      setError(taskValidation.error || 'Укажите один номер задания от 1 до 25.');
      return;
    }

    if (mode === 'file' && !form.file) {
      setError('Выберите реальный файл. Названия без файла недостаточно.');
      return;
    }

    if (mode === 'link' && !cleanLink) {
      setError('Введите ссылку.');
      return;
    }

    if (mode === 'link' && !isProbablyUrl(cleanLink)) {
      setError('Проверьте ссылку: нужен адрес сайта, например https://example.com.');
      return;
    }

    const item = mode === 'link' ? buildLinkMaterial(cleanLink) : buildFileMaterialFromFile(form.file, cleanFileName);

    try {
      setIsSaving(true);
      setError('');
      await actions.addMaterial({
        taskNumber,
        topicTitle: cleanTopicTitle,
        type: mode,
        item,
        file: form.file,
        fileName: cleanFileName,
        url: cleanLink,
      });
      onBack();
    } catch (err) {
      setError(err?.message || 'Не удалось загрузить материал.');
    } finally {
      setIsSaving(false);
    }
  }

  const canSubmit = Boolean(form.taskNumber && (mode === 'file' ? form.file : form.link.trim()));

  return (
    <>
      <Header title="Загрузить материал" subtitle="Файл или ссылка сохраняется в библиотеку по номеру задания" onBack={onBack} />
      <Card className="form-stack">
        {error ? <div className="inline-error">{error}</div> : null}
        {context.studentId ? <div className="inline-note success">Материал загружается из карточки ученика. Укажите номер задания, чтобы он появился в релевантных материалах ученика.</div> : null}
        <Field label="Название темы" value={form.title} onChange={(title) => setForm({ ...form, title })} placeholder="Графики и функции" />
        <Field label="Номер задания" value={form.taskNumber} onChange={(taskNumber) => setForm({ ...form, taskNumber })} />

        <div className="material-picker-tabs" role="tablist" aria-label="Тип материала">
          {[
            ['file', '↓', 'Файл'],
            ['link', '↗', 'Ссылка'],
          ].map(([id, icon, label]) => (
            <button key={id} type="button" className={cx('material-picker-tab', mode === id && 'active')} onClick={() => { setMode(id); setError(''); }}>
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {mode === 'file' ? (
          <>
            <label className="file-drop-zone">
              <input type="file" onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setForm({ ...form, file, fileName: file?.name || '' });
              }} />
              <span className="file-drop-icon">↓</span>
              <strong>{form.fileName || 'Выбрать файл'}</strong>
              <span>Файл будет загружен через API; одно название без файла не сохраняется.</span>
            </label>
            <Field label="Название файла" value={form.fileName} onChange={(fileName) => setForm({ ...form, fileName })} placeholder="Теория.pdf" disabled={!form.file} />
          </>
        ) : null}

        {mode === 'link' ? (
          <Field label="Ссылка" value={form.link} onChange={(link) => setForm({ ...form, link })} placeholder="https://example.com/material" />
        ) : null}

        {canSubmit ? (
          <div className="empty-materials">
            Будет добавлено: {mode === 'link' ? `ссылка ${form.link}` : `файл ${form.fileName}`}.
            {form.title ? ` Тема: ${form.title}.` : ''}
          </div>
        ) : null}

        <Button onClick={submit} disabled={!canSubmit || isSaving}>{isSaving ? 'Загружаем…' : 'Загрузить материал'}</Button>
      </Card>
    </>
  );
}
