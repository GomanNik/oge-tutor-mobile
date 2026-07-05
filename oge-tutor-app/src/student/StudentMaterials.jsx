/*
 * OGE Tutor App — student materials screens.
 */
import React from 'react';
import { Badge, Card, EmptyState, Header, MaterialList, RowCard } from '../shared/ui.jsx';
import { formatMaterialCount } from '../shared/formatters.js';

export function StudentMaterials({ materials, openTopic }) {
  return <><Header title="Материалы" subtitle="Материалы сгруппированы по номерам заданий ОГЭ" />{materials.length ? materials.map((topic) => <RowCard key={topic.id} icon={topic.taskNumber} iconTone="blue" title={topic.title} subtitle={formatMaterialCount(topic.files.length)} onClick={() => openTopic(topic.id)} />) : <EmptyState title="Материалов пока нет" text="Материалы появятся после урока, ДЗ или назначения темы преподавателем." />}</>;
}

export function StudentMaterialTopic({ topic, onBack }) {
  if (!topic) return null;
  return <><Header title={topic.title} subtitle={formatMaterialCount(topic.files.length)} onBack={onBack} right={<Badge tone="blue">{topic.taskNumber}</Badge>} /><Card><MaterialList items={topic.files} /></Card></>;
}
