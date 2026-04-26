module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    status: 'ok',
    product: 'cron-health-checker',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
};
