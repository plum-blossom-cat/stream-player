/** @type {{ id: string, message: string, tone: "info" | "error" }[]} */
export const toasts = $state([]);

/**
 * @param {string} message
 * @param {"info" | "error"} [tone]
 */
export function showToast(message, tone = "info") {
  const id = Math.random().toString(36).slice(2);
  toasts.push({ id, message, tone });
  setTimeout(() => {
    const index = toasts.findIndex((t) => t.id === id);
    if (index !== -1) toasts.splice(index, 1);
  }, tone === "error" ? 6000 : 3600);
}
