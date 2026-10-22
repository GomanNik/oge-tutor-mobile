import { applyDecorators, Type as ClassType } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsObject, IsString, Matches, Max, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { OGE_TASK_MAX, OGE_TASK_MIN } from './contracts';

// Optional means absent; null must be explicitly supported by the wire contract.
function optional(required: boolean) {
  return required ? [] : [ValidateIf((_object, value) => value !== undefined)];
}

export function TextField(required = false, schema: { description?: string; minLength?: number; writeOnly?: boolean; format?: string } = {}) {
  return applyDecorators(ApiProperty({ type: String, required, ...schema }), ...optional(required), IsString());
}
export function RequiredText() {
  return applyDecorators(TextField(true, { minLength: 1 }), Matches(/\S/, { message: '$property must contain non-whitespace text' }));
}
export function EmailField() {
  return applyDecorators(TextField(true, { format: 'email' }), IsEmail());
}
export function PasswordField(required = true) {
  return applyDecorators(TextField(required, { minLength: 6, writeOnly: true }), MinLength(6));
}
export function EnumField(values: object | readonly string[], required = false, nullable = false) {
  const choices = Object.values(values) as string[];
  return applyDecorators(ApiProperty({ type: String, enum: choices, required, nullable }),
    ValidateIf((_object, value) => (required || value !== undefined) && !(nullable && value === null)), IsIn(choices));
}
export function BooleanField() {
  return applyDecorators(ApiProperty({ type: Boolean, required: false }), ...optional(false), IsBoolean());
}
export function DateField(required = false, allowEmpty = false) {
  return applyDecorators(ApiProperty({ type: String, required, ...(allowEmpty ? { description: 'ISO 8601 timestamp, or empty string when unavailable.' } : { format: 'date-time' }) }),
    ValidateIf((_object, value) => (required || value !== undefined) && !(allowEmpty && value === '')), IsISO8601({ strict: true }));
}
export function IntegerField(required = false, minimum = 0, maximum?: number) {
  return applyDecorators(ApiProperty({ type: 'integer', required, minimum, maximum }), ...optional(required), IsInt(), Min(minimum), ...(maximum === undefined ? [] : [Max(maximum)]));
}
export function TaskNumberField(required = true) {
  // Existing material forms submit task numbers as decimal strings.
  return applyDecorators(Transform(({ value }) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value), IntegerField(required, OGE_TASK_MIN, OGE_TASK_MAX));
}
export function TaskNumbersField(required = false) {
  return applyDecorators(ApiProperty({ type: 'array', items: { type: 'integer', minimum: OGE_TASK_MIN, maximum: OGE_TASK_MAX }, required, maxItems: OGE_TASK_MAX, uniqueItems: true }),
    ...optional(required), IsArray(), ArrayMaxSize(OGE_TASK_MAX), ArrayUnique(), IsInt({ each: true }), Min(OGE_TASK_MIN, { each: true }), Max(OGE_TASK_MAX, { each: true }));
}
export function NestedField(type: ClassType<unknown>, required = false) {
  return applyDecorators(ApiProperty({ type: () => type, required }), ...optional(required), IsObject(), ValidateNested(), Type(() => type));
}
export function NestedArrayField(type: ClassType<unknown>, required = false, maxItems?: number) {
  return applyDecorators(ApiProperty({ type: () => type, isArray: true, required, maxItems }), ...optional(required), IsArray(),
    ...(maxItems === undefined ? [] : [ArrayMaxSize(maxItems)]), IsObject({ each: true }), ValidateNested({ each: true }), Type(() => type));
}
