export async function canThrow<T>(fn: () => Promise<T>): Promise<[T | undefined, any]> {
  try {
    const data = await fn();
    return [data, undefined];
  } catch (error) {
    return [undefined, error];
  }
}

export function canThrowSync<T>(fn: () => T): [T | undefined, any] {
  try {
    const data = fn();
    return [data, undefined];
  } catch (error) {
    return [undefined, error];
  }
}
