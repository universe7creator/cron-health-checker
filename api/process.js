export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cronExpression, lastRunTime, timezone } = req.body;

  if (!cronExpression) {
    return res.status(400).json({ error: 'cronExpression is required' });
  }

  // Parse cron expression (5 fields: min hour day month weekday)
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length < 5) {
    return res.status(400).json({ error: 'Invalid cron expression format. Expected: minute hour day month weekday' });
  }

  const [minute, hour, day, month, weekday] = parts;
  
  // Validate each field
  const validateField = (value, min, max, name) => {
    if (value === '*') return true;
    if (value.includes('/')) {
      const step = parseInt(value.split('/')[1]);
      return !isNaN(step) && step > 0;
    }
    if (value.includes(',')) {
      return value.split(',').every(v => {
        const num = parseInt(v);
        return !isNaN(num) && num >= min && num <= max;
      });
    }
    if (value.includes('-')) {
      const [start, end] = value.split('-').map(v => parseInt(v));
      return !isNaN(start) && !isNaN(end) && start >= min && end <= max && start <= end;
    }
    const num = parseInt(value);
    return !isNaN(num) && num >= min && num <= max;
  };

  const isValid = 
    validateField(minute, 0, 59, 'minute') &&
    validateField(hour, 0, 23, 'hour') &&
    validateField(day, 1, 31, 'day') &&
    validateField(month, 1, 12, 'month') &&
    validateField(weekday, 0, 6, 'weekday');

  if (!isValid) {
    return res.status(400).json({ 
      error: 'Invalid cron expression field(s)',
      healthy: false,
      status: 'critical'
    });
  }

  // Calculate next expected run
  const now = new Date();
  const tz = timezone || 'UTC';
  
  // Simple next run calculation — find next matching time
  let nextRun = new Date(now);
  const maxIterations = 366 * 24 * 60; // 1 year of minutes max
  
  let iterations = 0;
  let found = false;
  
  while (iterations < maxIterations && !found) {
    nextRun.setMinutes(nextRun.getMinutes() + 1);
    iterations++;
    
    const m = nextRun.getMinutes();
    const h = nextRun.getHours();
    const d = nextRun.getDate();
    const mo = nextRun.getMonth() + 1;
    const wd = nextRun.getDay();
    
    const matchMin = minute === '*' || (minute.includes('/') ? m % parseInt(minute.split('/')[1]) === 0 : m === parseInt(minute));
    const matchHour = hour === '*' || (hour.includes('/') ? h % parseInt(hour.split('/')[1]) === 0 : h === parseInt(hour));
    const matchDay = day === '*' || (day.includes(',') ? day.split(',').map(v => parseInt(v)).includes(d) : (day.includes('-') ? (() => { const [s,e] = day.split('-').map(v => parseInt(v)); return d >= s && d <= e; })() : d === parseInt(day)));
    const matchMonth = month === '*' || (month.includes(',') ? month.split(',').map(v => parseInt(v)).includes(mo) : (month.includes('-') ? (() => { const [s,e] = month.split('-').map(v => parseInt(v)); return mo >= s && mo <= e; })() : mo === parseInt(month)));
    const matchWd = weekday === '*' || (weekday.includes(',') ? weekday.split(',').map(v => parseInt(v)).includes(wd) : (weekday.includes('-') ? (() => { const [s,e] = weekday.split('-').map(v => parseInt(v)); return wd >= s && wd <= e; })() : wd === parseInt(weekday)));
    
    if (matchMin && matchHour && matchDay && matchMonth && matchWd) {
      found = true;
    }
  }

  // Determine health status
  let healthy = true;
  let status = 'healthy';
  let warnings = [];

  if (!lastRunTime) {
    warnings.push('Last run time not provided — cannot determine if job is running');
    status = 'warning';
  } else {
    const lastRun = new Date(lastRunTime);
    const minutesSinceRun = (now - lastRun) / 1000 / 60;
    
    // Estimate expected interval from cron expression
    const intervalMinutes = estimateInterval(minute, hour, day, month, weekday);
    
    if (minutesSinceRun > intervalMinutes * 3) {
      healthy = false;
      status = 'critical';
      warnings.push(`Last run was ${Math.round(minutesSinceRun)} minutes ago — expected interval: ~${intervalMinutes} minutes`);
    } else if (minutesSinceRun > intervalMinutes * 1.5) {
      status = 'warning';
      warnings.push(`Last run was ${Math.round(minutesSinceRun)} minutes ago — may be delayed`);
    }
  }

  res.status(200).json({
    healthy,
    status,
    cronExpression,
    nextExpectedRun: found ? nextRun.toISOString() : null,
    timezone: tz,
    lastRunTime: lastRunTime || null,
    warnings,
    expressionValid: true,
    checkedAt: now.toISOString()
  });
}

function estimateInterval(minute, hour, day, month, weekday) {
  // Rough interval estimation in minutes
  if (minute !== '*' && !minute.includes('/')) {
    if (hour === '*') return 60; // hourly
    if (day === '*' && month === '*') return 60 * 24; // daily
    return 60;
  }
  if (minute.includes('/')) {
    return parseInt(minute.split('/')[1]);
  }
  return 60;
}
