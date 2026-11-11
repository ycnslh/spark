const express = require('express');
const store = require('../services/scheduleStore');
const devices = require('../services/deviceStore');

const router = express.Router();
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const validId = (id) =>
  /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) && String(Number(id)) === id;

function validateSchedule(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Planification invalide';
  const fields = ['time', 'days', 'label', 'enabled'];
  if (!Object.keys(body).length || Object.keys(body).some((key) => !fields.includes(key))) {
    return 'Champs de planification invalides';
  }
  if (
    (!partial || 'time' in body) &&
    (typeof body.time !== 'string' ||
      body.time.length !== 5 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time))
  ) {
    return 'Heure invalide (HH:MM, de 00:00 à 23:59)';
  }
  if (
    (!partial || 'days' in body) &&
    (!Array.isArray(body.days) ||
      body.days.length === 0 ||
      body.days.length > 7 ||
      body.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
      new Set(body.days).size !== body.days.length)
  ) {
    return 'Jours invalides (entiers uniques de 0 à 6, au moins un jour)';
  }
  if ('label' in body && (typeof body.label !== 'string' || Array.from(body.label).length > 60))
    return 'Libellé invalide (max 60 caractères)';
  if ('enabled' in body && typeof body.enabled !== 'boolean')
    return 'État activé invalide (booléen requis)';
  return null;
}

router.get('/api/schedules', (_req, res) => res.json(store.listSchedules()));
router.get('/api/schedules/state', (_req, res) => res.json(store.getState()));
router.put('/api/schedules/state', (req, res) => {
  const body = req.body;
  if (!body || Object.keys(body).length !== 1 || typeof body.paused !== 'boolean') {
    return fail(res, 400, 'Pause invalide (paused doit être un booléen)');
  }
  return res.json(store.setPaused(body.paused));
});

router.post('/api/devices/:id/schedules', (req, res) => {
  if (!validId(req.params.id)) return fail(res, 400, 'ID d’appareil invalide');
  const device = devices.findById(Number(req.params.id));
  if (!device) return fail(res, 404, 'Appareil non trouvé');
  const error = validateSchedule(req.body);
  if (error) return fail(res, 400, error);
  const schedule = store.createSchedule(device.id, req.body);
  if (!schedule)
    return fail(res, 409, `Maximum de ${store.MAX_PER_DEVICE} planifications par appareil atteint`);
  return res.status(201).json({ success: true, schedule });
});

router.patch('/api/schedules/:id', (req, res) => {
  if (!validId(req.params.id)) return fail(res, 400, 'ID de planification invalide');
  const error = validateSchedule(req.body, true);
  if (error) return fail(res, 400, error);
  const schedule = store.updateSchedule(Number(req.params.id), req.body);
  if (!schedule) return fail(res, 404, 'Planification non trouvée');
  return res.json({ success: true, schedule });
});

router.delete('/api/schedules/:id', (req, res) => {
  if (!validId(req.params.id)) return fail(res, 400, 'ID de planification invalide');
  if (!store.deleteSchedule(Number(req.params.id)))
    return fail(res, 404, 'Planification non trouvée');
  return res.json({ success: true });
});

module.exports = { router, validateSchedule };
