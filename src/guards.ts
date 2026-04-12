export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

export function requireString(record: Record<string, unknown>, key: string, context: string): string {
  const value = getString(record, key);
  if (!value) {
    throw new Error(`Invalid ${context}: expected string field \"${key}\".`);
  }
  return value;
}

export function ensureRecord(payload: unknown, context: string): Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new Error(`Invalid ${context}: expected JSON object.`);
  }

  return payload;
}