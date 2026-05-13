/*
 * OGE Tutor App — unified material picker.
 * One component covers all attachment contexts: lesson materials, homework materials, and review materials.
 * It supports library selection by task number, frontend file-like attachments, links, duplicate protection, removal, and preview.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Field, MaterialList, cx } from './ui.jsx';
import {
  buildFileMaterialFromFile,
  buildLibraryMaterial,
  buildLinkMaterial,
  enrichLibraryFile,
  formatMaterialCount,
  isProbablyUrl,
  isSameMaterial,
  materialDisplayTitle,
  materialIcon,
  materialSourceText,
  normalizeText,
} from './formatters.js';

function normalizeTaskNumbers(value = []) {
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0);
}

function sortTopics(topics) {
  return [...(topics || [])].sort((a, b) => Number(a.taskNumber || 0) - Number(b.taskNumber || 0));
}

function makeLocalId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `mat-${crypto.randomUUID()}`;
  return `mat-${performance.now().toString(36).replace('.', '')}`;
}

function withLocalId(item) {
  return { ...item, localId: item.localId || makeLocalId() };
}

function isAttached(attachedItems, candidate) {
  return (attachedItems || []).some((item) => isSameMaterial(item, candidate));
}

function uniqueSelectedKeys(keys) {
  return Array.from(new Set(keys.filter(Boolean)));
}

export function MaterialPicker({
  materials = [],
  value = [],
  onChange,
  title = 'Прикрепить материалы',
  suggestedTaskNumbers = [],
  emptyText = 'Материалы пока не прикреплены.',
}) {
  const topics = useMemo(() => sortTopics(materials), [materials]);
  const normalizedSuggestedTasks = useMemo(() => normalizeTaskNumbers(suggestedTaskNumbers), [suggestedTaskNumbers]);
  const firstSuggestedTopic = topics.find((topic) => normalizedSuggestedTasks.includes(Number(topic.taskNumber)));
  const [activeTab, setActiveTab] = useState('library');
  const [taskNumber, setTaskNumber] = useState(firstSuggestedTopic?.taskNumber || '');
  const [selectedLibraryKeys, setSelectedLibraryKeys] = useState([]);
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!topics.length) {
      setTaskNumber('');
      setSelectedLibraryKeys([]);
      return;
    }
    if (topics.some((topic) => String(topic.taskNumber) === String(taskNumber))) return;
    if (firstSuggestedTopic?.taskNumber) setTaskNumber(firstSuggestedTopic.taskNumber);
    else {
      setTaskNumber('');
      setSelectedLibraryKeys([]);
    }
  }, [firstSuggestedTopic?.taskNumber, taskNumber, topics]);

  const selectedTopic = topics.find((topic) => String(topic.taskNumber) === String(taskNumber)) || null;
  const selectedTopicFiles = (selectedTopic?.files || []).map((file) => enrichLibraryFile(selectedTopic, file));

  function setAttachments(nextItems) {
    setMessage('');
    onChange?.(nextItems);
  }

  function addOne(candidate) {
    if (isAttached(value, candidate)) {
      setMessage('Этот материал уже прикреплён.');
      return false;
    }

    setAttachments([...(value || []), withLocalId(candidate)]);
    return true;
  }

  function removeAttachment(indexToRemove) {
    setAttachments((value || []).filter((_, index) => index !== indexToRemove));
  }

  function toggleLibraryFile(file) {
    if (!selectedTopic) return;
    const key = `${selectedTopic.id}:${file.id || materialDisplayTitle(file)}:${file.url || ''}`;
    setMessage('');
    setSelectedLibraryKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : uniqueSelectedKeys([...current, key]));
  }

  function selectedLibraryCandidates() {
    if (!selectedTopic) return [];
    return selectedTopicFiles
      .map((file) => ({
        key: `${selectedTopic.id}:${file.id || materialDisplayTitle(file)}:${file.url || ''}`,
        candidate: buildLibraryMaterial(selectedTopic, file),
      }))
      .filter((item) => selectedLibraryKeys.includes(item.key));
  }

  function addSelectedLibraryMaterials() {
    const selectedItems = selectedLibraryCandidates();

    if (!selectedItems.length) {
      setMessage('Выберите один или несколько материалов из библиотеки.');
      return;
    }

    const existing = [];
    const unique = [];

    selectedItems.forEach(({ candidate }) => {
      if (isAttached([...(value || []), ...unique], candidate)) existing.push(candidate);
      else unique.push(withLocalId(candidate));
    });

    if (!unique.length) {
      setMessage('Выбранные материалы уже прикреплены.');
      return;
    }

    onChange?.([...(value || []), ...unique]);
    setSelectedLibraryKeys([]);
    setMessage(existing.length ? 'Часть материалов уже была прикреплена, добавлены только новые.' : 'Материалы прикреплены.');
  }

  function addFile() {
    if (!selectedFile) {
      setMessage('Выберите реальный файл. Названия без файла недостаточно.');
      return;
    }

    const cleanFileName = normalizeText(fileName || selectedFile.name);

    if (addOne(buildFileMaterialFromFile(selectedFile, cleanFileName))) {
      setFileName('');
      setSelectedFile(null);
      setMessage('Файл прикреплён.');
    }
  }

  function addLink() {
    const cleanLink = normalizeText(linkUrl);

    if (!cleanLink) {
      setMessage('Введите ссылку.');
      return;
    }

    if (!isProbablyUrl(cleanLink)) {
      setMessage('Проверьте ссылку: нужен адрес сайта, например https://example.com.');
      return;
    }

    if (addOne(buildLinkMaterial(cleanLink))) {
      setLinkUrl('');
      setMessage('Ссылка прикреплена.');
    }
  }

  return (
    <Card>
      <div className="material-picker">
        <div className="material-picker-head">
          <strong className="material-picker-title">{title}</strong>
          <p className="material-picker-hint">Один и тот же файл, ссылка или материал из библиотеки не прикрепляются повторно.</p>
        </div>

        <div className="material-picker-tabs" role="tablist" aria-label="Источник материала">
          {[
            ['library', '📚', 'Библиотека'],
            ['file', '📄', 'Файл'],
            ['link', '🔗', 'Ссылка'],
          ].map(([id, icon, label]) => (
            <button key={id} type="button" onClick={() => { setActiveTab(id); setMessage(''); }} className={cx('material-picker-tab', activeTab === id && 'active')}>
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {message ? <div className={cx('inline-note', message.includes('уже') || message.includes('Проверьте') || message.includes('Выберите') || message.includes('Введите') ? 'warning' : 'success')}>{message}</div> : null}

        {activeTab === 'library' ? (
          <div className="material-source-panel">
            {topics.length ? (
              <>
                <div>
                  <p className="field-label">Номер задания</p>
                  <div className="task-chip-row">
                    {topics.map((topic) => {
                      const isSuggested = normalizedSuggestedTasks.includes(Number(topic.taskNumber));
                      return (
                        <button
                          key={topic.id}
                          type="button"
                          className={cx('task-chip', String(taskNumber) === String(topic.taskNumber) && 'active', isSuggested && 'suggested')}
                          onClick={() => { setTaskNumber(topic.taskNumber); setSelectedLibraryKeys([]); setMessage(''); }}
                        >
                          {topic.taskNumber}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="library-topic-head">
                  <div className="library-topic-main">
                    <strong title={selectedTopic?.title || 'Тема'}>{selectedTopic?.title || 'Тема'}</strong>
                    <p className="subtitle">{selectedTopic ? formatMaterialCount(selectedTopicFiles.length) : 'тема не выбрана'}</p>
                  </div>
                  {selectedTopic && normalizedSuggestedTasks.includes(Number(selectedTopic.taskNumber)) ? <span className="mini-label">по ДЗ</span> : null}
                </div>

                <div className="library-material-list">
                  {!selectedTopic ? <div className="empty-materials">Выберите номер задания, чтобы увидеть материалы.</div> : selectedTopicFiles.length ? selectedTopicFiles.map((file) => {
                    const key = `${selectedTopic.id}:${file.id || materialDisplayTitle(file)}:${file.url || ''}`;
                    const candidate = buildLibraryMaterial(selectedTopic, file);
                    const checked = selectedLibraryKeys.includes(key);
                    const alreadyAttached = isAttached(value, candidate);
                    return (
                      <button
                        type="button"
                        key={key}
                        className={cx('library-material-row', checked && 'selected', alreadyAttached && 'attached')}
                        onClick={() => !alreadyAttached && toggleLibraryFile(file)}
                        disabled={alreadyAttached}
                      >
                        <span className="library-check">{alreadyAttached ? '✓' : checked ? '✓' : ''}</span>
                        <span className="library-material-main">
                          <span className="library-material-title" title={materialDisplayTitle(file)}>{materialIcon(file.type)} {materialDisplayTitle(file)}</span>
                          <span className="library-material-source" title={materialSourceText(candidate)}>{materialSourceText(candidate)}</span>
                        </span>
                        <span className="library-material-state">{alreadyAttached ? 'уже добавлен' : checked ? 'выбран' : 'выбрать'}</span>
                      </button>
                    );
                  }) : <div className="empty-materials">В этой теме пока нет материалов.</div>}
                </div>

                <Button variant="soft" onClick={addSelectedLibraryMaterials} disabled={!selectedLibraryKeys.length}>Прикрепить выбранные</Button>
              </>
            ) : (
              <div className="empty-materials">В библиотеке пока нет материалов.</div>
            )}
          </div>
        ) : null}

        {activeTab === 'file' ? (
          <div className="material-source-panel">
            <p className="field-label">Файл</p>
            <label className="file-drop-zone">
              <input
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setSelectedFile(file);
                  setFileName(file?.name || '');
                }}
              />
              <span className="file-drop-icon" aria-hidden="true">📄</span>
              <strong title={fileName || 'Выбрать файл'}>{fileName || 'Выбрать файл'}</strong>
              <span>Файл будет передан в API-слой и загружен backend через FormData.</span>
            </label>
            <Field label="Название файла" value={fileName} onChange={setFileName} placeholder="Например: Конспект к уроку.pdf" />
            <Button variant="soft" onClick={addFile} disabled={!selectedFile}>Прикрепить файл</Button>
          </div>
        ) : null}

        {activeTab === 'link' ? (
          <div className="material-source-panel">
            <Field label="Ссылка" value={linkUrl} onChange={setLinkUrl} placeholder="https://example.com/material" />
            <p className="material-picker-hint">Название ссылки будет сформировано автоматически по адресу.</p>
            <Button variant="soft" onClick={addLink} disabled={!linkUrl.trim()}>Прикрепить ссылку</Button>
          </div>
        ) : null}

        <div>
          <p className="field-label">Прикреплено</p>
          {(value || []).length ? <MaterialList items={value} onRemove={removeAttachment} /> : <div className="empty-materials">{emptyText}</div>}
        </div>
      </div>
    </Card>
  );
}

export const AttachmentPicker = MaterialPicker;
