export function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Reads a named entry without falling through to `Object.prototype`, so a
 * policy identifier such as `constructor` never resolves to a built-in.
 */
export function ownValue<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return hasOwn(record, key) ? record[key] : undefined;
}
