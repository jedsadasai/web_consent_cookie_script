export interface ErrorBody {
  error: { code: string; message: string };
}

export const errorBody = (code: string, message: string): ErrorBody => ({ error: { code, message } });

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
