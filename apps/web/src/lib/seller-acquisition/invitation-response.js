const GENERIC_FAILURE_MESSAGE = "Seller invitation failed. Check phone/email and provider configuration.";
const GENERIC_SERVER_ERROR_MESSAGE = "Seller invitation failed. The server returned an unexpected response.";

/** @param {unknown} error */
function messageFromError(error) {
  if (typeof error === "string" && error.trim() !== "") return error;
  if (error !== null && typeof error === "object") {
    const message = /** @type {Record<string, unknown>} */ (error).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return undefined;
}

/**
 * Normalizes the invite API's `{ ok: true, data }` / `{ ok: false, error }` envelope
 * (and the legacy `{ ok: true, invitation }` shape) into a single shape the UI can
 * render without guessing at nesting.
 *
 * @param {unknown} payload
 * @returns {{ ok: boolean; invitation?: unknown; errorMessage?: string }}
 */
export function invitationResponseFromPayload(payload) {
  if (payload === null || typeof payload !== "object") {
    return { ok: false, errorMessage: GENERIC_SERVER_ERROR_MESSAGE };
  }

  const record = /** @type {Record<string, unknown>} */ (payload);

  if (record.ok === true) {
    const invitation = "data" in record ? record.data : "invitation" in record ? record.invitation : undefined;
    return { ok: true, invitation };
  }

  if (record.ok === false) {
    return { ok: false, errorMessage: messageFromError(record.error) ?? GENERIC_FAILURE_MESSAGE };
  }

  return { ok: false, errorMessage: GENERIC_SERVER_ERROR_MESSAGE };
}

/**
 * Reads and normalizes a fetch `Response` from the invite API, guarding against
 * malformed JSON, non-JSON bodies, and payloads that claim success on a non-2xx status.
 *
 * @param {Response} response
 * @returns {Promise<{ ok: boolean; invitation?: unknown; errorMessage?: string }>}
 */
export async function invitationResponseFromFetch(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      errorMessage: response.ok
        ? GENERIC_SERVER_ERROR_MESSAGE
        : `Seller invitation failed. Server responded with status ${response.status}.`,
    };
  }

  const result = invitationResponseFromPayload(payload);
  if (result.ok && !response.ok) {
    return {
      ok: false,
      errorMessage: result.errorMessage ?? `Seller invitation failed. Server responded with status ${response.status}.`,
    };
  }
  return result;
}
