export class CrunchyrollApiError extends Error {
  public readonly status: number | undefined;
  public readonly requestId: string | undefined;

  public constructor(message: string, status?: number, requestId?: string) {
    super(message);
    this.name = "CrunchyrollApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

export class CrunchyrollAuthError extends CrunchyrollApiError {
  public constructor(message: string, status?: number, requestId?: string) {
    super(message, status, requestId);
    this.name = "CrunchyrollAuthError";
  }
}

export class CrunchyrollValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CrunchyrollValidationError";
  }
}