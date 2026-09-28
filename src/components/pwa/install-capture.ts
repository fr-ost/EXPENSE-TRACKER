/**
 * Chrome and Edge fire `beforeinstallprompt` once per page load, often before
 * React hydrates. This inline script (rendered by the root layout) parks the
 * event on `window` so the "Install app" buttons can use it later.
 */
export const INSTALL_EVENT = "hisab:install-change";

export const INSTALL_CAPTURE = `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__hisabInstallPrompt=e;window.dispatchEvent(new Event("${INSTALL_EVENT}"))});window.addEventListener("appinstalled",function(){window.__hisabInstallPrompt=null;window.dispatchEvent(new Event("${INSTALL_EVENT}"))});`;
