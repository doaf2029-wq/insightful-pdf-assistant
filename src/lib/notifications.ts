export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    // Some browsers/iframes (e.g. cross-origin previews) throw on requestPermission.
    return false;
  }
};

export const notificationsSupported = (): boolean =>
  typeof window !== "undefined" && "Notification" in window;

export const notificationsBlocked = (): boolean =>
  notificationsSupported() && Notification.permission === "denied";

export const notify = (title: string, body?: string) => {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {
    /* ignore */
  }
};