/**
 * Errors that carry an HTTP-friendly status and a stable machine-readable code.
 * The web client translates `code` into a human message, so codes must not change.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);

/** Another open invoice for the same address already expects this exact amount. */
export class DuplicateAmountError extends Error {
  constructor() {
    super('An open invoice with the same exact amount already exists');
    this.name = 'DuplicateAmountError';
  }
}

/** The on-chain transfer has already been credited to some invoice. */
export class PaymentAlreadyUsedError extends AppError {
  constructor() {
    super(409, 'TX_ALREADY_USED', 'This transfer has already been used to pay an invoice');
    this.name = 'PaymentAlreadyUsedError';
  }
}
