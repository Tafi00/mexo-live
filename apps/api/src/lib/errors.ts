export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const err = {
  badRequest: (code: string, message: string, details?: unknown) => new AppError(code, message, 400, details),
  unauthorized: (message = 'Bạn cần đăng nhập') => new AppError('unauthorized', message, 401),
  forbidden: (message = 'Bạn không có quyền thực hiện thao tác này') => new AppError('forbidden', message, 403),
  notFound: (message = 'Không tìm thấy dữ liệu') => new AppError('not_found', message, 404),
  conflict: (code: string, message: string, details?: unknown) => new AppError(code, message, 409, details),
  locked: (code: string, message: string) => new AppError(code, message, 423),
  unavailable: (code: string, message: string) => new AppError(code, message, 503),
};
