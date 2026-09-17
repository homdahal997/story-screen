export async function getItem(key: string): Promise<string | null> {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
