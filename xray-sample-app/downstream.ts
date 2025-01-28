
import express from 'express';

const app = express();
const port = 3000;

// Endpoint to log request headers
app.get('/log-headers', (req, res) => {
  // Log all headers from the incoming request
  console.log('Request Headers:');
  console.log(JSON.stringify(req.headers, null, 2));

  res.json({
    message: 'Headers logged successfully',
    headers: req.headers
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});