export async function readErrorResponse(response: Response): Promise<string> {
  const text = await response.text();

  try {
    const payload = JSON.parse(text);
    if (payload?.error?.message) {
      return payload.error.message;
    }
  } catch {
    return text || `HTTP ${response.status}`;
  }

  return text || `HTTP ${response.status}`;
}
