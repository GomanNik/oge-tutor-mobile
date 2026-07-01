export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: FieldErrors = {},
  ) {
    super(message);
  }
}

export function validationError(message = 'Проверьте заполненные поля.', fieldErrors: FieldErrors = {}) {
  return new AppError(422, 'validation_error', message, fieldErrors);
}

export function unauthorized(message = 'Сессия истекла. Войдите заново.') {
  return new AppError(401, 'unauthorized', message);
}

export function forbidden(message = 'Недостаточно прав для этого действия.') {
  return new AppError(403, 'forbidden', message);
}

export function notFound(message = 'Данные не найдены.') {
  return new AppError(404, 'not_found', message);
}

export function conflict(message = 'Конфликт данных. Обновите страницу и повторите действие.', fieldErrors: FieldErrors = {}) {
  return new AppError(409, 'conflict', message, fieldErrors);
}
