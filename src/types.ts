export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export const success: <T>(data: T) => Result<T> = (data) => ({
  success: true,
  data,
});

export const error: <T>(err: string) => Result<T> = (err) => ({
  success: false,
  error: err,
});
