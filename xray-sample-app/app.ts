import axios from 'axios';
import express, { Express } from 'express';

// Initialize Express app
const app: Express = express();
const PORT: number = parseInt(process.env.PORT || '8080');

app.use(express.json());

app.get('/lambda-call', async (req, res) => {
  try {
    // Call the external endpoint
    const response = await axios.get('http://localhost:3000/log-headers');
    
    // Return the response from the external service
    res.status(200).json(response.data);
  } catch (error) {
    // Handle any errors that occur during the request
    res.status(500).json({ 
      error: 'Failed to call external endpoint',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Listening for requests on http://localhost:${PORT}`);
});
