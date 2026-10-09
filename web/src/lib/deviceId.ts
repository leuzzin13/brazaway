const KEY = 'truck-router.device_id';
export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `dev-${Math.random().toString(36).slice(2)}${Date.now()}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}
