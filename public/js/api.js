async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  listDevices: () => request('/api/devices'),
  createDevice: (payload) => request('/api/devices', { method: 'POST', body: JSON.stringify(payload) }),
  deleteDevice: (mac) => request(`/api/devices/${encodeURIComponent(mac)}`, { method: 'DELETE' }),
  wakeDevice: (mac) => request(`/api/wake/${encodeURIComponent(mac)}`, { method: 'POST' }),
  getStatus: () => request('/api/status'),
  getHistory: (id) => request(`/api/devices/${id}/history`),
};
