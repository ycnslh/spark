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
  listSchedules: () => request('/api/schedules'),
  createSchedule: (id, payload) =>
    request(`/api/devices/${id}/schedules`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSchedule: (id, payload) =>
    request(`/api/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteSchedule: (id) => request(`/api/schedules/${id}`, { method: 'DELETE' }),
  getScheduleState: () => request('/api/schedules/state'),
  setSchedulePaused: (paused) =>
    request('/api/schedules/state', {
      method: 'PUT',
      body: JSON.stringify({ paused }),
    }),
  listTokens: (id) => request(`/api/devices/${id}/tokens`),
  createToken: (id, label) =>
    request(`/api/devices/${id}/tokens`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  revokeToken: (id, tokenId) =>
    request(`/api/devices/${id}/tokens/${tokenId}`, { method: 'DELETE' }),
  listDevices: () => request('/api/devices'),
  createDevice: (payload) =>
    request('/api/devices', { method: 'POST', body: JSON.stringify(payload) }),
  updateDevice: (id, payload) =>
    request(`/api/devices/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteDevice: (mac) => request(`/api/devices/${encodeURIComponent(mac)}`, { method: 'DELETE' }),
  wakeDevice: (mac) => request(`/api/wake/${encodeURIComponent(mac)}`, { method: 'POST' }),
  getStatus: () => request('/api/status'),
  refreshStatus: (id) => request(`/api/status/${id}/refresh`, { method: 'POST' }),
  getHistory: (id, limit) => request(`/api/devices/${id}/history${limit ? `?limit=${limit}` : ''}`),
};
