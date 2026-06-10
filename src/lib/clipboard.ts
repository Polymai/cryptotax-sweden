export async function copyText(text) {
  const value = String(text || "");
  if (!value.trim()) return { ok: false, message: "Nothing to copy yet." };
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return { ok: true, message: "Copied." };
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    return { ok: true, message: "Copied." };
  } catch (error) {
    return { ok: false, message: error.message || "Copy failed." };
  }
}
