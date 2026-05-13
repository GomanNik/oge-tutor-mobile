/*
 * OGE Tutor App — teacher materials library screens.
 * Materials are managed through backend actions with duplicate checks before upload.
 */
import React, { useState } from 'react';
import {
  buildFileMaterialFromFile,
  buildLinkMaterial,
  formatMaterialCount,
  isProbablyUrl,
  isSameMaterial,
  normalizeText,
} from '../shared/formatters.js';
import { Button, Card, Field, Header, MaterialList, RowCard, Section, cx } from '../shared/ui.jsx';
import { logger } from '../shared/logger.js';
import { validateTaskNumbersInput } from '../shared/validation.js';

function findTopic(data, topicId) {
  return data.materials.find((topic) => topic.id === topicId) || null;
}

export function MaterialsList({ data, actions, openUpload }) {
  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const selectedTopic = findTopic(data, selectedTopicId);

  if (selectedTopic) {
    return <MaterialTopicDetail topic={selectedTopic} actions={actions} onBack={() => setSelectedTopicId(null)} />;
  }

  return (
    <>
      <Header title="Материалы" subtitle="Библиотека по номерам заданий ОГЭ" />
      <Button onClick={openUpload}>Загрузить материал</Button>
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
      )) : <Card><p className="subtitle">Материалы пока не добавлены.</p></Card>}
    </>
  );
}

function MaterialTopicDetail({ topic, actions, onBack }) {
  const [error, setError] = useState('');

  async function removeFile(indexToRemove) {
    const file = topic.files[indexToRemove];
    if (!file?.id) return;
    logger.ui('action=material.remove.click screen=TeacherMaterials userRole=teacher', { topicId: topic.id, fileId: file.id });

    try {
      setError('');
      logger.form('material.remove.submit', { topicId: topic.id, fileId: file.id });
      await actions.removeMaterialFile(topic.id, file.id);
    } catch (err) {
      setError(err?.message || 'Не удалось удалить материал.');
    }
  }

  return (
    <>
      <Header title={topic.title} subtitle={`Задание ${topic.taskNumber} · ${formatMaterialCount(topic.files.length)}`} onBack={onBack} />
      <Card className="form-stack">
        {error ? <div className="inline-error">{error}</div> : null}
        <MaterialList items={topic.files.map((file) => ({ ...file, taskNumber: topic.taskNumber, topicId: topic.id, topicTitle: topic.title }))} onRemove={removeFile} />
      </Card>
    </>
  );
}

export function UploadMaterial({ data, actions, onBack }) {
  const [form, setForm] = useState({ title: '', taskNumber: '', fileName: '', file: null, link: '' });
  const [mode, setMode] = useState('file');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    logger.ui('action=material.upload.click screen=TeacherMaterials userRole=teacher');
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
    const existing = data.materials.find((material) => Number(material.taskNumber) === taskNumber);
    const currentFiles = existing?.files || [];

    if (currentFiles.some((file) => isSameMaterial(file, item))) {
      setError('Такой материал уже есть в этой теме.');
      return;
    }

    try {
      setIsSaving(true);
      setError('');
      const payload = {
        taskNumber,
        topicTitle: cleanTopicTitle,
        type: mode,
        item,
        file: form.file,
        fileName: cleanFileName,
        url: cleanLink,
      };
      logger.form('material.upload.submit', { ...payload, file: form.file ? { name: form.file.name, size: form.file.size } : null });
      const result = await actions.addMaterial(payload);
      logger.nav('after material.upload back to list', { materialId: result?.material?.id, requestId: result?.requestId });
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
        <Field label="Название темы" value={form.title} onChange={(title) => setForm({ ...form, title })} placeholder="Графики и функции" />
        <Field label="Номер задания" value={form.taskNumber} onChange={(taskNumber) => setForm({ ...form, taskNumber })} />

        <div className="material-picker-tabs" role="tablist" aria-label="Тип материала">
          {[
            ['file', '📄', 'Файл'],
            ['link', '🔗', 'Ссылка'],
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
              <span className="file-drop-icon">📄</span>
              <strong>{form.fileName || 'Выбрать файл'}</strong>
              <span>Файл уйдёт в API через FormData; одно название без файла не сохраняется.</span>
            </label>
            <Field label="Название файла" value={form.fileName} onChange={(fileName) => setForm({ ...form, fileName })} placeholder="Теория.pdf" disabled={!form.file} />
          </>
        ) : null}

        {mode === 'link' ? (
          <Field label="Ссылка" value={form.link} onChange={(link) => setForm({ ...form, link })} placeholder="https://example.com/material" />
        ) : null}

        {canSubmit ? (
          <div className="empty-materials">
            Будет добавлено: {mode === 'link' ? `🔗 ${form.link}` : `📄 ${form.fileName}`}.
            {form.title ? ` Тема: ${form.title}.` : ''}
          </div>
        ) : null}

        <Button onClick={submit} disabled={!canSubmit || isSaving}>{isSaving ? 'Загружаем…' : 'Загрузить материал'}</Button>
      </Card>
    </>
  );
}
