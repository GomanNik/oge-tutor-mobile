/*
 * OGE Tutor App — API error wrapper.
 * Keeps UI error handling independent from transport details.
 */
export class ApiError extends Error {
  constructor(message, code = 'api_error', details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

export function getErrorMessage(error) {
  if (!error) return 'Неизвестная ошибка.';
  if (error instanceof ApiError) return error.message;
  if (typeof error.message === 'string' && error.message.trim()) return error.message;
  return 'Не удалось выполнить действие.';
}
